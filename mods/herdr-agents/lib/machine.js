// The footer: the machine the app runs on and the plans' limits, as wb's status line has them.
// Reading what the system prints, and what the footer says. No host calls.

/**
 * Prints the machine's figures (`sh -c`): on macOS memory, load, swap, the thermal pressure
 * level and the battery; on Linux what /proc tells of the same. The cores everywhere.
 */
export const MACHINE_SCRIPT = [
  'if [ "$(uname)" = Darwin ]; then',
  "  sysctl hw.memsize vm.loadavg kern.memorystatus_level kern.memorystatus_vm_pressure_level vm.swapusage",
  "  notifyutil -g com.apple.system.thermalpressurelevel",
  "  pmset -g batt",
  "else",
  "  awk '{ print \"vm.loadavg: { \" $1 \" }\" }' /proc/loadavg",
  "  grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo",
  "fi",
  'echo "cores: $(getconf _NPROCESSORS_ONLN)"',
].join("\n") + " 2>/dev/null";

/** Asks macOS its thermal state (0 nominal .. 3 critical): `osascript` with these. */
export const THERMAL_ARGS = ["-l", "JavaScript", "-e", 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.thermalState'];

/** One reading of the processors' sensors from macmon (`brew install macmon`), about a second. */
export const MACMON_ARGS = ["pipe", "-s", "1", "-i", "1000"];

const HEAT = ["nominal", "fair", "serious", "critical"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const found = (re, text) => {
  const match = re.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/**
 * MACHINE_SCRIPT's output -> { cores, memory (bytes), load, free (percent), pressure (macOS's
 * level: 1 normal, 2 warn, 4 critical), swap (bytes), thermal (the pressure level), battery
 * (percent), plugged }. What is not there is null.
 */
export function parseMachine(stdout) {
  const text = String(stdout ?? "");
  const kib = (name) => found(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"), text);
  const total = kib("MemTotal");
  const available = kib("MemAvailable");
  const swapTotal = kib("SwapTotal");
  const swapFree = kib("SwapFree");
  const memsize = found(/hw\.memsize: (\d+)/, text);
  const level = found(/kern\.memorystatus_level: (\d+)/, text);
  const swapMb = found(/vm\.swapusage:.*used = ([\d.]+)M/, text);
  // pmset names the battery on a line of its own; a Mac without one prints only the power source.
  const battery = /InternalBattery[^\n]*?(\d+)%/.exec(text);
  return {
    cores: found(/^cores: (\d+)/m, text) || null,
    memory: memsize ?? (total != null ? total * 1024 : null),
    load: found(/vm\.loadavg: \{ ([\d.]+)/, text),
    free: level ?? (total && available != null ? Math.round((available / total) * 100) : null),
    pressure: found(/kern\.memorystatus_vm_pressure_level: (\d+)/, text),
    swap: swapMb != null ? swapMb * 1024 * 1024 : swapTotal != null && swapFree != null ? (swapTotal - swapFree) * 1024 : null,
    thermal: found(/thermalpressurelevel (\d+)/, text),
    battery: battery ? Number(battery[1]) : null,
    plugged: battery ? /'AC Power'/.test(text) : null,
  };
}

/** osascript's answer to THERMAL_ARGS -> 0..3, or null. */
export function parseThermal(stdout) {
  const state = found(/^\s*(\d+)\s*$/, String(stdout ?? ""));
  return state != null && state < HEAT.length ? state : null;
}

/** macmon's line -> { clock (MHz of the performance cores), busy (0..1), degrees, watts, fan, fanTop }, or null. */
export function parseMacmon(stdout) {
  let raw;
  try {
    raw = JSON.parse(String(stdout ?? "").trim().split("\n").pop());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  let fan = null;
  let fanTop = null;
  for (const one of Array.isArray(raw.fans) ? raw.fans : []) {
    if (number(one?.rpm) != null && one.rpm >= (fan ?? -1)) {
      fan = one.rpm;
      fanTop = number(one.max_rpm);
    }
  }
  return { clock: number(raw.pcpu_freq_mhz), busy: number(raw.pcpu_active_ratio), degrees: number(raw.temp?.cpu_temp_avg), watts: number(raw.cpu_power), fan, fanTop };
}

/** How busy all the processors are together, 0..1, from a process table (`cpu`: percent of one core). */
export function machineCpu(table, cores) {
  if (!table || !(cores > 0)) return null;
  let busy = 0;
  for (const proc of table.values()) busy += proc.cpu || 0;
  return Math.min(1, busy / 100 / cores);
}

/** A limit's kind as a span: "5h", "7d", "90m", "spend". */
export function spanOf(kind) {
  if (kind === "five_hour") return "5h";
  if (kind === "seven_day") return "7d";
  if (kind === "spend_limit") return "spend";
  const minutes = /^(\d+)m$/.exec(String(kind ?? ""));
  if (!minutes) return String(kind ?? "");
  const n = Number(minutes[1]);
  return n >= 1440 && n % 1440 === 0 ? `${n / 1440}d` : n >= 60 && n % 60 === 0 ? `${n / 60}h` : `${n}m`;
}

/** How long a span is, to put the windows in order: the shorter first, a spend limit last. */
const spanMinutes = (kind) => {
  if (kind === "five_hour") return 300;
  if (kind === "seven_day") return 10080;
  const minutes = /^(\d+)m$/.exec(String(kind ?? ""));
  return minutes ? Number(minutes[1]) : Infinity;
};

/**
 * The plans' limits from telemetry records on the local machine: for each agent ("claude", "codex")
 * and each window, what the newest record says. A window that has reset since says nothing.
 * -> [{ agent, windows: [{ kind, span, percent, resetsAt }] }], Claude's first.
 */
export function plansOf(records, now = Date.now()) {
  const newest = new Map(); // agent \n kind -> { limit, at }
  for (const record of records ?? []) {
    if (!record?.agent) continue;
    const at = record.updatedAt ?? record.startedAt ?? 0;
    for (const limit of record.limits ?? []) {
      if (limit.resetsAt != null && limit.resetsAt <= now) continue;
      const key = `${record.agent}\n${limit.kind}`;
      const held = newest.get(key);
      if (!held || at > held.at) newest.set(key, { limit, at });
    }
  }
  const plans = new Map();
  for (const [key, { limit }] of newest) {
    const agent = key.slice(0, key.indexOf("\n"));
    if (!plans.has(agent)) plans.set(agent, []);
    plans.get(agent).push({ kind: limit.kind, span: spanOf(limit.kind), percent: limit.percent, resetsAt: limit.resetsAt ?? null });
  }
  const rank = (agent) => (agent === "claude" ? 0 : agent === "codex" ? 1 : 2);
  return [...plans]
    .map(([agent, windows]) => ({ agent, windows: windows.sort((a, b) => spanMinutes(a.kind) - spanMinutes(b.kind)) }))
    .sort((a, b) => rank(a.agent) - rank(b.agent) || a.agent.localeCompare(b.agent));
}

const pad = (n) => String(n).padStart(2, "0");

/** When a limit resets, in local time: "15:04" today, "Tu 15:04" on another day. */
export function resetText(at, now = Date.now()) {
  if (at == null) return "";
  const when = new Date(at);
  const today = new Date(now);
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return when.toDateString() === today.toDateString() ? clock : `${DAYS[when.getDay()]} ${clock}`;
}

/** How far a value has climbed: 0 green, 0.5 yellow from `yellow`, 0.75 orange from `orange`, 1 red from `red`. */
export function stepLevel(value, yellow, orange, red) {
  if (value == null) return null;
  return value >= red ? 1 : value >= orange ? 0.75 : value >= yellow ? 0.5 : 0;
}

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)}G`;

/**
 * What the footer says, in order: [{ key, label, value, level (0..1 or null: a plain value),
 * extra (dim, after the value), tip, agent (a plan's) }]. A group starts with `group: true`
 * (the plans, the cost), to stand apart from the one before.
 *
 * machine: parseMachine's, with `heat` (parseThermal's) and `sensors` (parseMacmon's) when
 * known; cpu: machineCpu's; agents: { cpu (percent of one core), rss (KiB) } of the agents
 * listed; clockTop: the highest clock seen (MHz); plans: plansOf's; cost: the sessions' (USD).
 */
export function footerItems({ machine, cpu, agents, clockTop, context, plans, cost, now = Date.now() }, { memText, costText }) {
  const items = [];
  const m = machine ?? {};
  const cores = m.cores;
  if (cpu != null) {
    const share = agents?.cpu != null && cores ? `${Math.round(agents.cpu / cores)}%` : "";
    items.push({
      key: "cpu", label: "CPU", value: `${Math.round(cpu * 100)}%`, level: stepLevel(cpu, 0.5, 0.7, 0.9), extra: share ? `[${share}]` : "",
      tip: `Processors: how busy all ${cores} cores are together. In brackets: the share the agents listed take, with all they started. Yellow from 50%, orange from 70%, red from 90%.`,
    });
  }
  if (m.load != null && cores) {
    items.push({
      key: "load", label: "load", value: `${m.load.toFixed(1)}/${cores}`, level: stepLevel(m.load, 0.75 * cores, cores, 2 * cores),
      tip: "Load: processes running or waiting to run, averaged over the last minute, out of the cores. Yellow from three quarters of one per core, orange from one, red from two.",
    });
  }
  const s = m.sensors;
  if (s?.clock > 0) {
    const top = Math.max(clockTop ?? 0, s.clock);
    // Busy cores well under the highest clock seen: the Mac is throttling.
    const level = (s.busy ?? 0) >= 0.7 ? stepLevel(-s.clock, -top * 0.75, -top * 0.75, -top / 2) : 0;
    items.push({
      key: "clock", label: "clock", value: `${(s.clock / 1000).toFixed(1)}GHz`, level,
      tip: `Clock of the performance cores now; the highest seen is ${(top / 1000).toFixed(1)} GHz. Orange or red when they are busy yet under three quarters or half of it: the Mac is throttling.`,
    });
  }
  if (m.free != null) {
    // macOS says how hard it is pressed; elsewhere the share free decides.
    const level = m.pressure != null ? stepLevel(m.pressure, 2, 4, 4) : stepLevel(-m.free, -20, -10, -5);
    items.push({
      key: "mem", label: "mem", value: `${m.free}% free`, level, extra: agents?.rss ? `[${memText(agents.rss)}]` : "",
      tip: `Memory free${m.pressure != null ? ", as macOS counts it" : ""}. In brackets: what the agents listed take, with all they started.${m.pressure != null ? " Colored by the memory pressure macOS reports: yellow when it warns, red when critical." : " Yellow under 20% free, orange under 10%, red under 5%."}`,
    });
  }
  if (m.swap != null && m.swap > 0) {
    items.push({
      key: "swap", label: "swap", value: gib(m.swap), level: m.memory ? stepLevel(m.swap, m.memory / 8, m.memory / 4, m.memory / 2) : 0,
      tip: "Swap: memory moved out to the disk. Yellow from an eighth of the memory, orange from a quarter, red from half.",
    });
  }
  if (m.heat > 0) {
    items.push({
      key: "heat", label: "heat", value: HEAT[Math.min(m.heat, HEAT.length - 1)], level: stepLevel(m.heat, 1, 2, 3),
      tip: "Heat: macOS's thermal state, shown above nominal. At serious and critical the Mac slows itself down.",
    });
  }
  if (s?.degrees > 0) {
    items.push({
      key: "temp", label: "temp", value: `${Math.round(s.degrees)}°`, level: stepLevel(s.degrees, 80, 90, 100),
      tip: "Temperature of the processors, in °C. Yellow from 80, orange from 90, red from 100.",
    });
  }
  if (s?.fanTop > 0) {
    items.push({
      key: "fan", label: "fan", value: String(Math.round(s.fan)), level: stepLevel(s.fan, s.fanTop * 0.5, s.fanTop * 0.7, s.fanTop * 0.9),
      tip: `Fan speed, in turns a minute, out of ${Math.round(s.fanTop)} at most. Yellow from half, orange from 70%, red from 90%.`,
    });
  }
  if (s?.watts > 0) {
    items.push({ key: "power", label: "power", value: `${Math.round(s.watts)}W`, level: 0, tip: "Power the processors and the memory draw now, in watts." });
  }
  if (m.battery != null) {
    items.push({
      key: "battery", label: m.plugged ? "plugged" : "battery", value: `${m.battery}%`, level: m.plugged ? 0 : stepLevel(-m.battery, -30, -15, -15),
      tip: m.plugged ? "Battery, plugged in." : "Battery, on its own power. Yellow under 30%, red under 15%.",
    });
  }
  if (context != null) {
    items.push({
      key: "context", group: true, label: "ctx max", value: `${Math.round(context)}%`,
      level: Math.max(0, Math.min(1, context / 100)),
      tip: "Highest context usage reported by an agent in this panel, including folded rows.",
    });
  }
  for (const plan of plans ?? []) {
    const name = plan.agent === "claude" ? "Claude" : plan.agent === "codex" ? "Codex" : plan.agent;
    const tip = `${name}'s plan limits, as its sessions' telemetry last reported them.${plan.windows.map((w) => ` ${w.span} window: ${Math.round(w.percent)}% used${w.resetsAt != null ? `, resets ${resetText(w.resetsAt, now)}` : ""}.`).join("")} Yellow from 50%, orange from 75%, red from 90%.`;
    plan.windows.forEach((w, index) => {
      items.push({
        key: `plan-${plan.agent}-${w.kind}`, agent: plan.agent, group: index === 0, label: w.span, value: `${Math.round(w.percent)}%`,
        level: stepLevel(Math.floor(w.percent), 50, 75, 90), extra: w.resetsAt != null ? `→ ${resetText(w.resetsAt, now)}` : "", tip,
      });
    });
  }
  if (cost > 0) {
    items.push({ key: "cost", group: true, label: "", value: costText(cost), level: null, tip: "What the sessions of the agents listed have cost so far, as their telemetry reports it." });
  }
  return items;
}
