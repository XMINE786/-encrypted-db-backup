// Human-friendly schedule parsing. Lets users type things like
//   "every 2 minutes", "3 min", "hourly", "every 6 hours", "daily at 2am",
//   "weekly", or a raw cron string — and converts to a cron expression that
// node-cron understands. Pure (no deps), so it's safe in client + server.

export interface ParsedSchedule {
  cron: string; // "" = no schedule
  label: string; // human description of what it means
  error?: string; // set when the input couldn't be understood
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Loose cron validation (5 or 6 space-separated fields of cron-y chars). */
function looksLikeCron(s: string): boolean {
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return false;
  return parts.every((p) => /^[\d*/,\-]+$/.test(p));
}

/**
 * Convert friendly text (or a raw cron) into a cron expression.
 * Returns `{ cron: "" }` for empty/none. Sets `error` when unparseable.
 */
export function parseSchedule(input: string): ParsedSchedule {
  const raw = (input || "").trim();
  if (!raw || /^(no|none|off|never|disabled?)$/i.test(raw))
    return { cron: "", label: "No schedule" };

  const s = raw.toLowerCase();

  // every N seconds  (node-cron 6-field)
  let m = s.match(/^(?:every\s+)?(\d+)\s*(?:s|sec|secs|second|seconds)$/);
  if (m) {
    const n = +m[1];
    if (n < 1 || n > 59) return { cron: "", error: "seconds must be 1–59", label: "" };
    return { cron: `*/${n} * * * * *`, label: n === 1 ? "every second" : `every ${n} seconds` };
  }

  // every minute / every N minutes
  if (/^(?:every\s+)?(?:1\s*)?(?:m|min|minute)s?$/.test(s) || s === "every minute")
    return { cron: "* * * * *", label: "every minute" };
  m = s.match(/^(?:every\s+)?(\d+)\s*(?:m|min|mins|minute|minutes)$/);
  if (m) {
    const n = +m[1];
    if (n < 1 || n > 59) return { cron: "", error: "minutes must be 1–59", label: "" };
    return { cron: n === 1 ? "* * * * *" : `*/${n} * * * *`, label: n === 1 ? "every minute" : `every ${n} minutes` };
  }

  // hourly / every hour / every N hours
  if (/^(?:hourly|every\s+hour)$/.test(s)) return { cron: "0 * * * *", label: "every hour" };
  m = s.match(/^(?:every\s+)?(\d+)\s*(?:h|hr|hrs|hour|hours)$/);
  if (m) {
    const n = +m[1];
    if (n < 1 || n > 23) return { cron: "", error: "hours must be 1–23", label: "" };
    return { cron: n === 1 ? "0 * * * *" : `0 */${n} * * *`, label: n === 1 ? "every hour" : `every ${n} hours` };
  }

  // daily [at H[:MM] [am|pm]]
  m = s.match(/^(?:daily|every\s+day)(?:\s+at\s+(.+))?$/);
  if (m) {
    const { h, min, err } = parseTime(m[1]);
    if (err) return { cron: "", error: err, label: "" };
    return { cron: `${min} ${h} * * *`, label: `daily at ${pad(h)}:${pad(min)}` };
  }

  // weekly [on <day>] [at H:MM]
  m = s.match(/^(?:weekly|every\s+week)(?:\s+on\s+(\w+))?(?:\s+at\s+(.+))?$/);
  if (m) {
    const dow = m[1] ? dayToNum(m[1]) : 0;
    if (dow == null) return { cron: "", error: `unknown day "${m[1]}"`, label: "" };
    const { h, min, err } = parseTime(m[2]);
    if (err) return { cron: "", error: err, label: "" };
    return { cron: `${min} ${h} * * ${dow}`, label: `weekly (${DAYS[dow]} ${pad(h)}:${pad(min)})` };
  }

  // raw cron passthrough
  if (looksLikeCron(raw)) return { cron: raw, label: describeCron(raw) };

  return {
    cron: "",
    error: `Couldn't understand "${raw}". Try e.g. "every 2 minutes", "hourly", "daily at 2am".`,
    label: "",
  };
}

// ---- Structured schedule builder (for the dynamic dropdown UI) -------------

export type SchedType =
  | "minutes"
  | "hours"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "advanced";

export const SCHED_TYPES: { value: SchedType; label: string }[] = [
  { value: "minutes", label: "Every N minutes" },
  { value: "hours", label: "Every N hours" },
  { value: "daily", label: "Daily (at time)" },
  { value: "weekly", label: "Weekly (day + time)" },
  { value: "monthly", label: "Monthly (date + time)" },
  { value: "quarterly", label: "Quarterly (date + time)" },
  { value: "advanced", label: "Advanced (raw cron)" },
];

export const WEEKDAYS = [
  { v: 0, l: "Sunday" },
  { v: 1, l: "Monday" },
  { v: 2, l: "Tuesday" },
  { v: 3, l: "Wednesday" },
  { v: 4, l: "Thursday" },
  { v: 5, l: "Friday" },
  { v: 6, l: "Saturday" },
];

export interface SchedParts {
  type: SchedType;
  count: number; // for minutes/hours
  hour: number; // 0–23 (time of day)
  minute: number; // 0–59
  weekday: number; // 0–6 (Sun–Sat)
  day: number; // 1–31 (day of month)
  cron: string; // raw, for "advanced"
}

export const DEFAULT_PARTS: SchedParts = {
  type: "hours",
  count: 1,
  hour: 2,
  minute: 0,
  weekday: 1,
  day: 1,
  cron: "",
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.floor(Number(n) || lo)));

/** Build a cron expression from structured parts. Ranges are clamped so an
 *  invalid value (e.g. 25 hours, 61 minutes) can never produce a bad cron. */
export function buildCronFromParts(p: SchedParts): string {
  const H = clamp(p.hour, 0, 23);
  const M = clamp(p.minute, 0, 59);
  const D = clamp(p.day, 1, 31);
  switch (p.type) {
    case "minutes": {
      const n = clamp(p.count, 1, 60);
      return n >= 60 ? "0 * * * *" : n === 1 ? "* * * * *" : `*/${n} * * * *`;
    }
    case "hours": {
      const n = clamp(p.count, 1, 24);
      return n >= 24 ? "0 0 * * *" : n === 1 ? "0 * * * *" : `0 */${n} * * *`;
    }
    case "daily":
      return `${M} ${H} * * *`;
    case "weekly":
      return `${M} ${H} * * ${clamp(p.weekday, 0, 6)}`;
    case "monthly":
      return `${M} ${H} ${D} * *`;
    case "quarterly":
      // day D of every 3rd month starting Jan (Jan/Apr/Jul/Oct).
      return `${M} ${H} ${D} */3 *`;
    case "advanced":
      return (p.cron || "").trim();
  }
}

/** Reverse a cron back into structured parts for editing. Unknown patterns
 *  fall back to the "advanced" (raw cron) mode. */
export function partsFromCron(cron: string): SchedParts {
  const base = { ...DEFAULT_PARTS };
  if (!cron) return base;
  const p = cron.trim().split(/\s+/);
  if (p.length === 5) {
    const [min, hr, dom, mon, dow] = p;
    const num = (x: string) => /^\d+$/.test(x);
    if (cron === "* * * * *") return { ...base, type: "minutes", count: 1 };
    let m = min.match(/^\*\/(\d+)$/);
    if (m && hr === "*" && dom === "*" && mon === "*" && dow === "*")
      return { ...base, type: "minutes", count: +m[1] };
    if (min === "0" && hr === "*" && dom === "*" && mon === "*" && dow === "*")
      return { ...base, type: "hours", count: 1 };
    m = hr.match(/^\*\/(\d+)$/);
    if (min === "0" && m && dom === "*" && mon === "*" && dow === "*")
      return { ...base, type: "hours", count: +m[1] };
    if (num(min) && num(hr) && dom === "*" && mon === "*" && dow === "*")
      return { ...base, type: "daily", hour: +hr, minute: +min };
    if (num(min) && num(hr) && dom === "*" && mon === "*" && num(dow))
      return { ...base, type: "weekly", hour: +hr, minute: +min, weekday: +dow };
    if (num(min) && num(hr) && num(dom) && mon === "*/3" && dow === "*")
      return { ...base, type: "quarterly", hour: +hr, minute: +min, day: +dom };
    if (num(min) && num(hr) && num(dom) && mon === "*" && dow === "*")
      return { ...base, type: "monthly", hour: +hr, minute: +min, day: +dom };
  }
  return { ...base, type: "advanced", cron };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayToNum(d: string): number | null {
  const i = DAYS.findIndex((x) => x.toLowerCase() === d.slice(0, 3).toLowerCase());
  return i >= 0 ? i : null;
}

function parseTime(t?: string): { h: number; min: number; err?: string } {
  if (!t) return { h: 0, min: 0 };
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return { h: 0, min: 0, err: `bad time "${t}"` };
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return { h: 0, min: 0, err: `time out of range "${t}"` };
  return { h, min };
}

/** Best-effort human description of a cron string (for showing stored values). */
export function describeCron(cron: string): string {
  if (!cron) return "No schedule";
  const p = cron.trim().split(/\s+/);
  if (p.length === 6) {
    const sm = p[0].match(/^\*\/(\d+)$/);
    if (sm && p.slice(1).join(" ") === "* * * * *") return `every ${sm[1]} seconds`;
  }
  if (p.length === 5) {
    const [min, hr, dom, mon, dow] = p;
    if (cron === "* * * * *") return "every minute";
    let mm = min.match(/^\*\/(\d+)$/);
    if (mm && hr === "*" && dom === "*" && mon === "*" && dow === "*") return `every ${mm[1]} minutes`;
    if (min === "0" && hr === "*" && dom === "*" && mon === "*" && dow === "*") return "every hour";
    mm = hr.match(/^\*\/(\d+)$/);
    if (min === "0" && mm && dom === "*" && mon === "*" && dow === "*") return `every ${mm[1]} hours`;
    mm = dom.match(/^\*\/(\d+)$/);
    if (min === "0" && hr === "0" && mm && mon === "*" && dow === "*") return `every ${mm[1]} days`;
    const num = (x: string) => /^\d+$/.test(x);
    if (num(min) && num(hr) && dom === "*" && mon === "*" && dow === "*")
      return `daily at ${pad(+hr)}:${pad(+min)}`;
    if (num(min) && num(hr) && dom === "*" && mon === "*" && num(dow))
      return `weekly on ${DAYS[+dow] || dow} at ${pad(+hr)}:${pad(+min)}`;
    if (num(min) && num(hr) && num(dom) && mon === "*/3" && dow === "*")
      return `quarterly on day ${+dom} at ${pad(+hr)}:${pad(+min)}`;
    if (num(min) && num(hr) && num(dom) && mon === "*" && dow === "*")
      return `monthly on day ${+dom} at ${pad(+hr)}:${pad(+min)}`;
  }
  return cron; // fall back to the raw expression
}
