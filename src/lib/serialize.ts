import { ConnectionRow, BackupRow } from "./db";

// Public shape of a connection — never leak the encrypted password blob.
export interface ConnectionDTO {
  id: number;
  name: string;
  engine: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  hasPassword: boolean;
  options: string | null;
  schema: string | null;
  schedule: string | null;
  retention: number;
  created_at: string;
  updated_at: string;
}

export function toConnectionDTO(c: ConnectionRow): ConnectionDTO {
  return {
    id: c.id,
    name: c.name,
    engine: c.engine,
    host: c.host,
    port: c.port,
    database: c.database,
    username: c.username,
    hasPassword: !!c.password_enc,
    options: c.options,
    schema: c.schema,
    schedule: c.schedule,
    retention: c.retention,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

export type BackupDTO = BackupRow & { connectionName?: string; engine?: string };
