// Process figures from `ps`. No host calls.

/** The columns `parsePs` expects, without headers. Works with BSD (macOS) and procps (Linux) ps. */
export const PS_ARGS = ["-axo", "pid=,ppid=,pcpu=,rss=,time="];

/** CPU time as ps prints it, "1:22.69" (BSD) or "1-02:03:04" (procps) -> seconds, or null. */
export function cpuSeconds(text) {
  const found = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)$/.exec(String(text ?? ""));
  if (!found) return null;
  return Number(found[1] ?? 0) * 86400 + Number(found[2] ?? 0) * 3600 + Number(found[3]) * 60 + Number(found[4].replace(",", "."));
}

/**
 * `ps -axo pid=,ppid=,pcpu=,rss=,time=` ->
 * Map(pid -> { pid, ppid, cpu (percent, as ps says), rss (KiB), time (CPU seconds so far, or null) }).
 */
export function parsePs(stdout) {
  const table = new Map();
  for (const line of String(stdout ?? "").split("\n")) {
    const found = /^\s*(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+)(?:\s+(\S+))?\s*$/.exec(line);
    if (!found) continue;
    const pid = Number(found[1]);
    table.set(pid, { pid, ppid: Number(found[2]), cpu: Number(found[3].replace(",", ".")), rss: Number(found[4]), time: cpuSeconds(found[5]) });
  }
  return table;
}

/**
 * What ps calls %CPU differs: macOS gives recent load, Linux the average since the process
 * started. This puts the load between two readings in its place: `table` with each `cpu`
 * replaced by the CPU time used since `before` (an earlier `parsePs` table), over `seconds`.
 * A process without a time, or no earlier reading, keeps what ps said.
 */
export function withRates(table, before, seconds) {
  if (!before || !(seconds > 0)) return table;
  const out = new Map();
  for (const [pid, proc] of table) {
    const then = before.get(pid)?.time;
    // Not there before, or a new process under an old pid: all its time is from this stretch.
    const used = proc.time == null ? null : then == null || then > proc.time ? proc.time : proc.time - then;
    out.set(pid, used == null ? proc : { ...proc, cpu: Math.round((used / seconds) * 1000) / 10 });
  }
  return out;
}

/**
 * Whether the table's CPU times are in whole seconds (procps), not hundredths (BSD). Load
 * told from two such readings moves in steps of one second over the time between them, so it
 * needs readings further apart.
 */
export function coarseTimes(table) {
  let timed = false;
  for (const proc of table.values()) {
    if (proc.time == null) continue;
    if (!Number.isInteger(proc.time)) return false;
    timed = true;
  }
  return timed;
}

/** Map(ppid -> [pid]) for a table from `parsePs`. */
export function childIndex(table) {
  const index = new Map();
  for (const { pid, ppid } of table.values()) {
    if (index.has(ppid)) index.get(ppid).push(pid);
    else index.set(ppid, [pid]);
  }
  return index;
}

/**
 * CPU and memory of a process and everything below it: { cpu, rss, count }, or null when the
 * process is gone. Pass the result of `childIndex(table)` when asking for many roots.
 */
export function treeUsage(table, root, index = childIndex(table)) {
  if (!table.has(root)) return null;
  return forestUsage(table, [root], index);
}

/** CPU and memory of multiple process trees, counting shared descendants once. */
export function forestUsage(table, roots, index = childIndex(table)) {
  const seen = new Set();
  const todo = [...roots];
  let cpu = 0;
  let rss = 0;
  while (todo.length) {
    const pid = todo.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const proc = table.get(pid);
    if (!proc) continue;
    cpu += proc.cpu;
    rss += proc.rss;
    for (const kid of index.get(pid) ?? []) todo.push(kid);
  }
  return { cpu: Math.round(cpu * 10) / 10, rss, count: seen.size };
}

/**
 * Walks up from `pid` to the first process that is one of `roots` (a Map or Set of pids).
 * Returns { root, depth } (depth 0: it is the root itself), or null when no root is above it.
 */
export function nearestRoot(table, pid, roots) {
  const seen = new Set();
  let at = pid;
  let depth = 0;
  while (at > 0 && !seen.has(at)) {
    if (roots.has(at)) return { root: at, depth };
    seen.add(at);
    const proc = table.get(at);
    if (!proc) return null;
    at = proc.ppid;
    depth += 1;
  }
  return null;
}
