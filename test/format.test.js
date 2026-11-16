import { test } from "node:test";
import assert from "node:assert/strict";
import { cpuText, memText, costText, percentText, fitColumns, prText, prNote, countWidth } from "../mods/herdr-agents/lib/format.js";

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

test("prText: the number; nothing for none or a closed one", () => {
  const pr = (state) => ({ number: 126, state, url: null, title: "" });
  assert.deepEqual(["open", "draft", "merged", "closed"].map((state) => prText(pr(state))), ["#126", "#126", "#126", ""]);
  assert.equal(prText(null), "");
});

test("prNote says the state", () => {
  assert.equal(prNote({ number: 126, state: "merged" }), "#126 merged");
  assert.equal(prNote(null), "");
});

test("status counts in a narrow top bar: the least urgent go first", () => {
  // As the view ranks them: blocked, done, working, idle, unknown.
  const counts = [["blocked", 1, 1], ["working", 3, 3], ["done", 1, 2], ["idle", 12, 4], ["unknown", 2, 5]]
    .map(([key, count, rank]) => ({ key, width: countWidth(count), rank }));
  assert.equal(countWidth(4), 20);
  assert.equal(countWidth(12), 27);
  assert.deepEqual(fitColumns(counts, 400, 12), ["blocked", "working", "done", "idle", "unknown"]);
  // Three counts of one digit need 20 + 32 + 32 px.
  assert.deepEqual(fitColumns(counts, 84, 12), ["blocked", "working", "done"]);
  assert.deepEqual(fitColumns(counts, 110 - 28, 12), ["blocked", "done"]);
  assert.deepEqual(fitColumns(counts, 30, 12), ["blocked"]);
});
