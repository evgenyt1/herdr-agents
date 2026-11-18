import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMachine, parseThermal, parseMacmon, machineCpu, spanOf, plansOf, resetText, stepLevel, footerItems } from "../mods/herdr-agents/lib/machine.js";
import { memText, costText } from "../mods/herdr-agents/lib/format.js";
import { parsePs } from "../mods/herdr-agents/lib/ps.js";
import { demoData } from "../mods/herdr-agents/demo.js";

const MAC = `hw.memsize: 38654705664
vm.loadavg: { 3.42 3.10 2.95 }
kern.memorystatus_level: 41
kern.memorystatus_vm_pressure_level: 1
vm.swapusage: total = 2048.00M  used = 1103.25M  free = 944.75M  (encrypted)
com.apple.system.thermalpressurelevel 0
Now drawing from 'AC Power'
 -InternalBattery-0 (id=1234)	87%; charging; 0:42 remaining present: true
cores: 12
`;

const LINUX = `vm.loadavg: { 0.52 }
MemTotal:       16000000 kB
MemAvailable:    4000000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
cores: 4
`;

test("parseMachine: macOS", () => {
  assert.deepEqual(parseMachine(MAC), {
    cores: 12, memory: 38654705664, load: 3.42, free: 41, pressure: 1, swap: 1103.25 * 1024 * 1024, thermal: 0, battery: 87, plugged: true,
  });
});

test("parseMachine: a Mac without a battery, Linux, nothing", () => {
  const desktop = parseMachine("Now drawing from 'AC Power'\ncores: 8\n");
  assert.equal(desktop.battery, null);
  assert.equal(desktop.plugged, null);
  assert.equal(parseMachine("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t12%; discharging\n").plugged, false);
  assert.deepEqual(parseMachine(LINUX), {
    cores: 4, memory: 16000000 * 1024, load: 0.52, free: 25, pressure: null, swap: 500000 * 1024, thermal: null, battery: null, plugged: null,
  });
  assert.deepEqual(Object.values(parseMachine("")).filter((value) => value != null), []);
  assert.equal(parseMachine("cores: \n").cores, null);
});

test("parseThermal and parseMacmon", () => {
  assert.equal(parseThermal("2\n"), 2);
  assert.equal(parseThermal("7\n"), null);
  assert.equal(parseThermal("error"), null);
  const line = JSON.stringify({ pcpu_freq_mhz: 3800, pcpu_active_ratio: 0.8, cpu_power: 12.5, temp: { cpu_temp_avg: 64.2 }, fans: [{ rpm: 1200, max_rpm: 6000 }, { rpm: 1300, max_rpm: 5800 }] });
  assert.deepEqual(parseMacmon(`${line}\n`), { clock: 3800, busy: 0.8, degrees: 64.2, watts: 12.5, fan: 1300, fanTop: 5800 });
  assert.deepEqual(parseMacmon("{}"), { clock: null, busy: null, degrees: null, watts: null, fan: null, fanTop: null });
  assert.equal(parseMacmon("not json"), null);
  assert.equal(parseMacmon(""), null);
});

test("machineCpu: all processes over all cores, at most all of them", () => {
  const table = parsePs("1 0 150.0 100\n2 1 50.0 100\n3 1 0.0 100\n");
  assert.equal(machineCpu(table, 4), 0.5);
  assert.equal(machineCpu(table, 1), 1);
  assert.equal(machineCpu(null, 4), null);
  assert.equal(machineCpu(table, null), null);
});

test("spanOf", () => {
  assert.deepEqual(["five_hour", "seven_day", "spend_limit", "90m", "60m", "1440m", "2880m", "45m", "odd"].map(spanOf), ["5h", "7d", "spend", "90m", "1h", "1d", "2d", "45m", "odd"]);
});

test("plansOf: the newest record's figure for each agent and window; reset windows say nothing", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const later = Date.parse("2026-11-18T15:00:00Z");
  const week = Date.parse("2026-11-24T15:00:00Z");
  const records = [
    { agent: "codex", updatedAt: now - 10, limits: [{ kind: "seven_day", percent: 9, resetsAt: week }, { kind: "five_hour", percent: 2, resetsAt: later }] },
    { agent: "claude", updatedAt: now - 50, limits: [{ kind: "seven_day", percent: 3, resetsAt: week }, { kind: "five_hour", percent: 40, resetsAt: later }] },
    { agent: "claude", updatedAt: now - 5, limits: [{ kind: "seven_day", percent: 4, resetsAt: week }] },
    { agent: "claude", updatedAt: now - 1, limits: [{ kind: "spend_limit", percent: 10, resetsAt: now - 1 }] }, // reset already
    { agent: "claude", updatedAt: now - 1, limits: [{ kind: "five_hour", percent: 99, resetsAt: now - 1 }] },
    { agent: null, limits: [{ kind: "five_hour", percent: 99, resetsAt: later }] },
    null,
  ];
  assert.deepEqual(plansOf(records, now), [
    { agent: "claude", windows: [{ kind: "five_hour", span: "5h", percent: 40, resetsAt: later }, { kind: "seven_day", span: "7d", percent: 4, resetsAt: week }] },
    { agent: "codex", windows: [{ kind: "five_hour", span: "5h", percent: 2, resetsAt: later }, { kind: "seven_day", span: "7d", percent: 9, resetsAt: week }] },
  ]);
  assert.deepEqual(plansOf([], now), []);
  assert.deepEqual(plansOf(undefined, now), []);
});

test("resetText: the clock today, the weekday on another day", () => {
  const now = new Date(2026, 10, 18, 9, 30).getTime(); // a Wednesday
  assert.equal(resetText(new Date(2026, 10, 18, 15, 4).getTime(), now), "15:04");
  assert.equal(resetText(new Date(2026, 10, 24, 8, 0).getTime(), now), "Tu 08:00");
  assert.equal(resetText(null, now), "");
});

test("stepLevel", () => {
  assert.deepEqual([0.1, 0.5, 0.7, 0.95, null].map((v) => stepLevel(v, 0.5, 0.7, 0.9)), [0, 0.5, 0.75, 1, null]);
});

test("footerItems: wb's line, in its order, with its colors", () => {
  const now = new Date(2026, 10, 18, 9, 30).getTime();
  const machine = { ...parseMachine(MAC), heat: 2, sensors: { clock: 2000, busy: 0.9, degrees: 92, watts: 21.4, fan: 5000, fanTop: 6000 } };
  const plans = [{ agent: "claude", windows: [{ kind: "five_hour", span: "5h", percent: 76.4, resetsAt: new Date(2026, 10, 18, 15, 0).getTime() }, { kind: "seven_day", span: "7d", percent: 3, resetsAt: null }] }];
  const items = footerItems({ machine, cpu: 0.72, agents: { cpu: 240, rss: 3 * 1024 * 1024 }, clockTop: 4500, plans, cost: 234.4, now }, { memText, costText });
  assert.deepEqual(items.map((item) => [item.key, item.label, item.value, item.extra ?? "", item.level, !!item.group]), [
    ["cpu", "CPU", "72%", "[20%]", 0.75, false],
    ["load", "load", "3.4/12", "", 0, false],
    ["clock", "clock", "2.0GHz", "", 1, false], // busy and under half of the top: throttling
    ["mem", "mem", "41% free", "[3.0G]", 0, false],
    ["swap", "swap", "1.1G", "", 0, false],
    ["heat", "heat", "serious", "", 0.75, false],
    ["temp", "temp", "92°", "", 0.75, false],
    ["fan", "fan", "5000", "", 0.75, false],
    ["power", "power", "21W", "", 0, false],
    ["battery", "plugged", "87%", "", 0, false],
    ["plan-claude-five_hour", "5h", "76%", "→ 15:00", 0.75, true],
    ["plan-claude-seven_day", "7d", "3%", "", 0, false],
    ["cost", "", "$234", "", null, true],
  ]);
  assert.ok(items.every((item) => item.tip));
});

test("footerItems: only what is known; nominal heat and no swap say nothing", () => {
  const items = footerItems({ machine: { ...parseMachine("cores: 8\nvm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M\n"), heat: 0 }, cpu: 0.1, agents: null, plans: [], cost: 0 }, { memText, costText });
  assert.deepEqual(items.map((item) => [item.key, item.value, item.extra ?? ""]), [["cpu", "10%", ""]]);
  assert.deepEqual(footerItems({}, { memText, costText }), []);
  // On its battery, low: red.
  const low = footerItems({ machine: { battery: 12, plugged: false } }, { memText, costText });
  assert.deepEqual(low.map((item) => [item.label, item.level]), [["battery", 1]]);
});

test("the demo's machine fills every part of the footer", () => {
  const demo = demoData();
  const records = [...demo.records.values()].flat();
  const items = footerItems({
    machine: { ...demo.machine.stats, heat: demo.machine.heat, sensors: demo.machine.sensors },
    cpu: machineCpu(demo.procs.get(""), demo.machine.stats.cores),
    agents: { cpu: 100, rss: 1024 },
    clockTop: demo.machine.clockTop,
    plans: plansOf(records),
    cost: 20,
  }, { memText, costText });
  assert.deepEqual(items.map((item) => item.key), ["cpu", "load", "clock", "mem", "swap", "heat", "temp", "fan", "power", "battery", "plan-claude-five_hour", "plan-claude-seven_day", "plan-codex-five_hour", "plan-codex-seven_day", "cost"]);
});
