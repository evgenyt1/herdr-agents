// Reading agent-telemetry files (format v1) and matching them to terminals. No host calls.

import { nearestRoot } from "./ps.js";

/** The format version this reader knows. */
export const VERSION = 1;

/**
 * A file without a pid cannot be seen to have ended: it counts as live until its last change
 * is this old (ms). Files change at every turn, so a session quiet for longer is rare; a file
 * left behind by a session that crashed before its pid was known is what this drops.
 */
export const NO_PID_LIVE_MS = 6 * 3600 * 1000;

/** Prints the telemetry folder of the machine it runs on (`sh -c`). */
export const DIR_SCRIPT = 'printf %s "${AGENT_TELEMETRY_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/agent-telemetry}"';

/** Where the files are when no shell can be asked (same rule as DIR_SCRIPT). */
export function telemetryDir(env, home) {
  if (env?.AGENT_TELEMETRY_DIR) return env.AGENT_TELEMETRY_DIR;
  const cache = env?.XDG_CACHE_HOME || `${String(home ?? "").replace(/[\\/]+$/, "")}/.cache`;
  return `${cache}/agent-telemetry`;
}

/** A session's file: `<agent>-<session>.json`. Writers' temporary files (`.….tmp`) are not. */
export function isTelemetryFile(name) {
  const text = String(name ?? "");
  return text.endsWith(".json") && !text.startsWith(".") && !text.endsWith(".tmp");
}

const text = (value) => (typeof value === "string" && value ? value : null);
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const time = (value) => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * One file's text -> a record, or null when it is not a v1 file, or has neither a pid nor an
 * hc terminal id (nothing to match it by).
 * Absent or misshapen optional fields come back as null; unknown fields are ignored.
 */
export function parseTelemetry(source) {
  let raw;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== VERSION) return null;
  const pid = Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null;
  const hc = text(raw.terminal?.hc);
  if (pid == null && !hc) return null;
  const context = raw.context && typeof raw.context === "object" ? raw.context : {};
  const used = number(context.used);
  const window = number(context.window);
  const percent = number(context.percent) ?? (used != null && window ? Math.round((used / window) * 100) : null);
  const effort = text(raw.effort) ?? (number(raw.effort) != null ? String(raw.effort) : null);
  return {
    agent: text(raw.agent),
    session: text(raw.session),
    pid,
    cwd: text(raw.cwd),
    hc,
    model: text(raw.model),
    effort,
    state: text(raw.state),
    context: percent == null && window == null ? null : { used, window, percent },
    limits: (Array.isArray(raw.limits) ? raw.limits : [])
      .map((limit) => ({ kind: text(limit?.kind), percent: number(limit?.percent), resetsAt: time(limit?.resetsAt) }))
      .filter((limit) => limit.kind && limit.percent != null),
    cost: number(raw.cost?.usd),
    startedAt: time(raw.startedAt),
    updatedAt: time(raw.updatedAt),
  };
}

/**
 * Pairs records with terminals of one machine.
 *
 * terminals: [{ address, id, pids, created }] where `id` is the terminal's id on its machine
 * ("t7"), `pids` its root processes (the foreground program first, then the terminal's first
 * process) and `created` when the terminal was made (ms).
 * records: results of `parseTelemetry` read from that machine.
 * procs: that machine's process table (`parsePs`), or null when there is none: then no file can
 * be called dead, and only exact pids match.
 * now: the time (ms), to tell how old a file without a pid is.
 * Returns Map(address -> record). A file whose pid is not running is skipped, and so is one
 * without a pid that has not changed for NO_PID_LIVE_MS. `terminal.hc` decides first, unless
 * the file was last written before that terminal was made (ids are given out again: it is an
 * earlier session's); the pid (the terminal's program or one below it) second. When several
 * files claim one terminal, the one nearest its foreground program wins, then the newest.
 */
export function matchTelemetry(terminals, records, procs = null, now = Date.now()) {
  const byId = new Map();
  const byPid = new Map();
  for (const terminal of terminals ?? []) {
    byId.set(terminal.id, terminal);
    for (const pid of terminal.pids ?? []) if (pid > 0 && !byPid.has(pid)) byPid.set(pid, terminal);
  }
  const claims = new Map();
  for (const record of records ?? []) {
    if (!record) continue;
    // When the file last changed, as far as it says. Without any time it cannot be called old.
    const written = record.updatedAt ?? record.startedAt ?? null;
    if (record.pid == null ? written != null && now - written > NO_PID_LIVE_MS : procs && !procs.has(record.pid)) continue;
    const above = record.pid == null ? null : procs ? nearestRoot(procs, record.pid, byPid) : byPid.has(record.pid) ? { root: record.pid, depth: 0 } : null;
    const named = record.hc ? byId.get(record.hc) : null;
    const earlier = named && written != null && named.created != null && written < named.created;
    const terminal = (named && !earlier ? named : null) || (above && byPid.get(above.root));
    if (!terminal) continue;
    // How far below this terminal's own program the session runs; unknown sorts last.
    const near = above && byPid.get(above.root) === terminal ? above.depth + (above.root === terminal.pids?.[0] ? 0 : 0.5) : Infinity;
    const claim = { record, near, at: record.updatedAt ?? 0 };
    const held = claims.get(terminal.address);
    if (!held || claim.near < held.near || (claim.near === held.near && claim.at > held.at)) claims.set(terminal.address, claim);
  }
  return new Map([...claims].map(([address, claim]) => [address, claim.record]));
}

/**
 * "claude-opus-5-5-20261001" -> "opus-5.5": the vendor prefix and a date stamp say nothing in a
 * column, and a version reads as one.
 */
export function shortModel(model) {
  if (!model) return "";
  return String(model).replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)(?=$|\[)/, "-$1.$2");
}

/** A record's model and effort as one text: "opus-5.5/xhigh"; either alone when the other is missing. */
export function modelEffort(record) {
  return [shortModel(record?.model), record?.effort].filter(Boolean).join("/");
}

/**
 * The percent used of one limit window ("five_hour", "seven_day"), or null. A file is not
 * rewritten while its session is quiet: once the window has reset, its figure says nothing.
 */
export function limitPercent(record, kind, now = Date.now()) {
  const limit = record?.limits?.find((one) => one.kind === kind);
  if (!limit || (limit.resetsAt != null && limit.resetsAt <= now)) return null;
  return limit.percent;
}
