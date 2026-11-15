import { test } from "node:test";
import assert from "node:assert/strict";
import { cpuText, memText, costText, percentText, fitColumns } from "../mods/herdr-agents/lib/format.js";

test("cpuText", () => {
  assert.deepEqual([0, 0.04, 0.5, 3.24, 9.96, 45.4, 145.2, null, undefined].map(cpuText), ["0%", "0%", "0.5%", "3.2%", "10%", "45%", "145%", "", ""]);
});

test("memText from KiB", () => {
  assert.deepEqual([0, 100, 86016, 1023000, 1023590, 1024 * 1024, 1363149, 12 * 1024 * 1024, null].map(memText), ["0M", "0M", "84M", "999M", "1.0G", "1.0G", "1.3G", "12G", ""]);
});

test("costText and percentText", () => {
  assert.deepEqual([0, 0.416, 4.12, 99.994, 99.995, 118.4, null].map(costText), ["$0.00", "$0.42", "$4.12", "$99.99", "$100", "$118", ""]);
  assert.deepEqual([0, 6.6, 23.5, 100, null].map(percentText), ["0%", "7%", "24%", "100%", ""]);
});

test("fitColumns keeps the most important columns that fit, in display order", () => {
  const columns = [
    { key: "a", width: 50, rank: 3 },
    { key: "b", width: 50, rank: 1 },
    { key: "c", width: 50, rank: 2 },
  ];
  assert.deepEqual(fitColumns(columns, 1000, 10), ["a", "b", "c"]);
  assert.deepEqual(fitColumns(columns, 170, 10), ["a", "b", "c"]);
  assert.deepEqual(fitColumns(columns, 169, 10), ["b", "c"]);
  assert.deepEqual(fitColumns(columns, 50, 10), ["b"]);
  assert.deepEqual(fitColumns(columns, 49, 10), []);
});
