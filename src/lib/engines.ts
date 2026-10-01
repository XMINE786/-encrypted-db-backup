// Definitions for every supported database engine: default ports, the CLI tool
// used to dump it, and how to build the dump command. Each dump writes a single
// stream to STDOUT, which we then encrypt into a .enc file.

export type EngineId =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "sqlserver"
  | "oracle"
  | "mongodb"
  | "sqlite";

export interface EngineDef {
  id: EngineId;
  label: string;
  defaultPort: number | null;
  /** CLI tool that must be installed on the host running DevGems. */
  tool: string;
  /** Human note about requirements/limitations. */
  note: string;
  /** File extension of the (pre-encryption) dump payload. */
  ext: string;
  /** Does this engine connect over the network (needs host/port)? */
  network: boolean;
  /** Does this engine support dumping a specific schema (or set of schemas)? */
  schemas?: boolean;
}

export const ENGINES: Record<EngineId, EngineDef> = {
  postgres: {
    id: "postgres",
    label: "PostgreSQL",
    defaultPort: 5432,
    tool: "pg_dump",
    note: "Requires pg_dump (postgresql-client) on the host.",
    ext: "sql",
    network: true,
    schemas: true,
  },
  mysql: {
    id: "mysql",
    label: "MySQL",
    defaultPort: 3306,
    tool: "mysqldump",
    note: "Requires mysqldump (mysql-client) on the host.",
    ext: "sql",
    network: true,
  },
  mariadb: {
    id: "mariadb",
    label: "MariaDB",
    defaultPort: 3306,
    tool: "mysqldump",
    note: "Uses mysqldump / mariadb-dump.",
    ext: "sql",
    network: true,
  },
  sqlserver: {
    id: "sqlserver",
    label: "SQL Server",
    defaultPort: 1433,
    tool: "mssql-scripter",
    note: "Requires mssql-scripter (pip install mssql-scripter).",
    ext: "sql",
    network: true,
  },
  oracle: {
    id: "oracle",
    label: "Oracle",
    defaultPort: 1521,
    tool: "sqlcl",
    note: "Best-effort schema+data dump via SQLcl. Server-side expdp is not used.",
    ext: "sql",
    network: true,
  },
  mongodb: {
    id: "mongodb",
    label: "MongoDB",
    defaultPort: 27017,
    tool: "mongodump",
    note: "Requires mongodump (mongodb-database-tools). Output is a BSON archive.",
    ext: "archive",
    network: true,
  },
  sqlite: {
    id: "sqlite",
    label: "SQLite",
    defaultPort: null,
    tool: "sqlite3",
    note: "Provide the database file path in the 'Database' field. Requires sqlite3.",
    ext: "sql",
    network: false,
  },
};

export interface ConnParams {
  engine: EngineId;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password: string; // already-decrypted plaintext
  options?: string | null; // extra CLI flags, space-separated
  schema?: string | null; // schema(s) to dump, comma/space separated (Postgres)
}

export interface DumpSpec {
  cmd: string;
  args: string[];
  /** Extra env vars for the child process (e.g. PGPASSWORD). */
  env: Record<string, string>;
}

/** Build the dump command + args + env for a connection. */
export function buildDumpCommand(p: ConnParams): DumpSpec {
  const extra = (p.options || "").trim() ? p.options!.trim().split(/\s+/) : [];
  switch (p.engine) {
    case "postgres": {
      // One -n flag per requested schema (comma/space separated). When none is
      // given, pg_dump dumps every schema as before.
      const schemaFlags = (p.schema || "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .flatMap((s) => ["-n", s]);
      const args = [
        "-h", p.host,
        "-p", String(p.port ?? 5432),
        "-U", p.username,
        "--no-password",
        "-d", p.database,
        ...schemaFlags,
        ...extra,
      ];
      return { cmd: "pg_dump", args, env: { PGPASSWORD: p.password } };
    }
    case "mysql":
    case "mariadb": {
      const args = [
        `-h${p.host}`,
        `-P${String(p.port ?? 3306)}`,
        `-u${p.username}`,
        `-p${p.password}`, // passed inline; child env is not logged
        "--single-transaction",
        "--routines",
        "--events",
        p.database,
        ...extra,
      ];
      return { cmd: "mysqldump", args, env: {} };
    }
    case "sqlserver": {
      const server = `${p.host},${p.port ?? 1433}`;
      const args = [
        "--connection-string",
        `Server=${server};Database=${p.database};User Id=${p.username};Password=${p.password};TrustServerCertificate=True;`,
        "--schema-and-data",
        ...extra,
      ];
      return { cmd: "mssql-scripter", args, env: {} };
    }
    case "oracle": {
      // SQLcl reads the script from stdin; connect string passed as arg.
      const conn = `${p.username}/${p.password}@${p.host}:${p.port ?? 1521}/${p.database}`;
      return { cmd: "sql", args: ["-S", conn, ...extra], env: {} };
    }
    case "mongodb": {
      const uri = p.password
        ? `mongodb://${encodeURIComponent(p.username)}:${encodeURIComponent(
            p.password
          )}@${p.host}:${p.port ?? 27017}/${p.database}`
        : `mongodb://${p.host}:${p.port ?? 27017}/${p.database}`;
      const args = ["--uri", uri, "--archive", "--gzip", ...extra];
      return { cmd: "mongodump", args, env: {} };
    }
    case "sqlite": {
      // p.database holds the path to the .db file.
      return { cmd: "sqlite3", args: [p.database, ".dump", ...extra], env: {} };
    }
    default:
      throw new Error(`Unsupported engine: ${(p as ConnParams).engine}`);
  }
}

/** Build a lightweight connectivity-test command per engine. */
export function buildTestCommand(p: ConnParams): DumpSpec {
  switch (p.engine) {
    case "postgres":
      return {
        cmd: "pg_isready",
        args: ["-h", p.host, "-p", String(p.port ?? 5432), "-U", p.username],
        env: { PGPASSWORD: p.password },
      };
    case "mysql":
    case "mariadb":
      return {
        cmd: "mysqladmin",
        args: [`-h${p.host}`, `-P${String(p.port ?? 3306)}`, `-u${p.username}`, `-p${p.password}`, "ping"],
        env: {},
      };
    case "mongodb":
      return {
        cmd: "mongosh",
        args: [
          `mongodb://${p.host}:${p.port ?? 27017}`,
          "--quiet",
          "--eval",
          "db.runCommand({ ping: 1 })",
        ],
        env: {},
      };
    case "sqlite":
      return { cmd: "sqlite3", args: [p.database, "SELECT 1;"], env: {} };
    default:
      // For engines without a cheap ping, fall back to the dump tool's version check.
      return { cmd: buildDumpCommand(p).cmd, args: ["--version"], env: {} };
  }
}

export const ENGINE_LIST = Object.values(ENGINES);
