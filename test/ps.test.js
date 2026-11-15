import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePs, cpuSeconds, withRates, coarseTimes, childIndex, treeUsage, nearestRoot } from "../mods/herdr-agents/lib/ps.js";

const OUT = `    1     0   0.1  12000
  100     1   2.5 400000
  101   100  10.0 100000
  102   101   0,5  50000
  200     1   0.0   8000
garbage line
`;

test("parsePs reads pid, ppid, cpu and rss, and skips what is not a row", () => {
  const table = parsePs(OUT);
  assert.equal(table.size, 5);
  assert.deepEqual(table.get(101), { pid: 101, ppid: 100, cpu: 10, rss: 100000, time: null });
  assert.deepEqual(parsePs("  7  1  21.0 374848   1:22.69\n").get(7), { pid: 7, ppid: 1, cpu: 21, rss: 374848, time: 82.69 });
  assert.equal(parsePs("7 1 0.0 100 00:00:02\n").get(7).time, 2);
  assert.equal(table.get(102).cpu, 0.5);
  assert.equal(parsePs("").size, 0);
  assert.equal(parsePs(undefined).size, 0);
});

test("treeUsage sums a process and everything below it", () => {
  const table = parsePs(OUT);
  assert.deepEqual(treeUsage(table, 100), { cpu: 13, rss: 550000, count: 3 });
  assert.deepEqual(treeUsage(table, 200, childIndex(table)), { cpu: 0, rss: 8000, count: 1 });
  assert.equal(treeUsage(table, 999), null);
});

test("treeUsage survives a loop in the table", () => {
  const table = parsePs("5 6 1.0 10\n6 5 1.0 10\n");
  assert.deepEqual(treeUsage(table, 5), { cpu: 2, rss: 20, count: 2 });
});

test("nearestRoot finds the closest root above a process", () => {
  const table = parsePs(OUT);
  const roots = new Set([100, 200]);
  assert.deepEqual(nearestRoot(table, 102, roots), { root: 100, depth: 2 });
  assert.deepEqual(nearestRoot(table, 100, roots), { root: 100, depth: 0 });
  assert.equal(nearestRoot(table, 1, roots), null);
  assert.equal(nearestRoot(table, 999, roots), null);
});

test("cpuSeconds reads BSD and procps times", () => {
  assert.equal(cpuSeconds("0:00.31"), 0.31);
  assert.equal(cpuSeconds("294:59.85"), 294 * 60 + 59.85);
  assert.equal(cpuSeconds("00:01:05"), 65);
  assert.equal(cpuSeconds("2-03:04:05"), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(cpuSeconds("0:00,50"), 0.5);
  assert.equal(cpuSeconds(undefined), null);
  assert.equal(cpuSeconds("?"), null);
});

test("withRates: CPU is the time used between two readings", () => {
  const before = parsePs("10 1 50.0 100 0:10.00\n11 10 50.0 100 0:01.00\n12 1 50.0 100 0:30.00\n");
  const now = parsePs("10 1 50.0 100 0:15.00\n11 10 50.0 100 0:01.00\n12 1 50.0 100 0:02.00\n13 1 50.0 100 0:01.00\n14 1 7.5 100\n");
  const rated = withRates(now, before, 10);
  assert.equal(rated.get(10).cpu, 50); // 5 s of CPU in 10 s
  assert.equal(rated.get(11).cpu, 0); // idle, whatever its lifetime average says
  assert.equal(rated.get(12).cpu, 20); // less time than before: another process under the same pid
  assert.equal(rated.get(13).cpu, 10); // started since the earlier reading
  assert.equal(rated.get(14).cpu, 7.5); // no time column: what ps said
  assert.equal(rated.get(10).rss, 100);
  assert.equal(withRates(now, null, 10), now);
  assert.equal(withRates(now, before, 0), now);
});

test("coarseTimes tells whole-second clocks (procps) from finer ones (BSD)", () => {
  assert.equal(coarseTimes(parsePs("1 0 0.0 10 00:00:02\n2 1 0.0 10 00:01:00\n")), true);
  assert.equal(coarseTimes(parsePs("1 0 0.0 10 0:02.00\n2 1 0.0 10 0:01.37\n")), false);
  assert.equal(coarseTimes(parsePs("1 0 0.0 10\n")), false);
});
