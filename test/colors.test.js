import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHex, mix, heat, percentLevel, modelLevel, effortLevel } from "../mods/herdr-agents/lib/colors.js";

test("parseHex reads the notations a theme uses", () => {
  assert.deepEqual(parseHex("#98c379"), [152, 195, 121, 255]);
  assert.deepEqual(parseHex("#0b102466"), [11, 16, 36, 102]);
  assert.deepEqual(parseHex("#fa0"), [255, 170, 0, 255]);
  assert.deepEqual(parseHex(" #98C379 "), [152, 195, 121, 255]);
  assert.equal(parseHex("rgb(1, 2, 3)"), null);
  assert.equal(parseHex(null), null);
});

test("mix goes from one color to the other", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#ff0000", "#0000ff", 0.25), "#bf0040");
  assert.equal(mix("#F00", "#00F", 0.25), "#bf0040");
  assert.equal(mix("#00000080", "#ffffff", 0.5), "#808080c0");
  // Out of range stays at the ends.
  assert.equal(mix("#102030", "#405060", -1), "#102030");
  assert.equal(mix("#102030", "#405060", 2), "#405060");
});

test("mix takes the nearer color when one cannot be read", () => {
  assert.equal(mix("green", "#ffffff", 0.4), "green");
  assert.equal(mix("green", "#ffffff", 0.6), "#ffffff");
});

test("heat runs green, yellow, red over 0..1", () => {
  const scale = ["#00ff00", "#ffff00", "#ff0000"];
  assert.equal(heat(scale, 0), "#00ff00");
  assert.equal(heat(scale, 0.25), "#80ff00");
  assert.equal(heat(scale, 0.5), "#ffff00");
  assert.equal(heat(scale, 0.75), "#ff8000");
  assert.equal(heat(scale, 1), "#ff0000");
  assert.equal(heat(scale, 7), "#ff0000");
  assert.equal(heat(scale, null), null);
});

test("percentLevel is the percent as 0..1", () => {
  assert.deepEqual([0, 27, 50, 100, 140, -3, null, undefined].map(percentLevel), [0, 0.27, 0.5, 1, 1, 0, null, null]);
});

test("modelLevel ranks a model by its tier", () => {
  const level = (model) => modelLevel(model);
  assert.equal(level("claude-haiku-5-5"), 0);
  assert.equal(level("claude-sonnet-5-5"), 0.25);
  assert.equal(level("claude-opus-5-5"), 0.75);
  assert.equal(level("claude-fable-5-2"), 1);
  assert.equal(level("claude-opus-5-5[1m]"), 0.75);
  assert.equal(level("gpt-6.1-mini"), 0);
  assert.equal(level("o4-mini"), 0);
  // A name as people write it.
  assert.equal(level("Opus 5.5"), 0.75);
  assert.equal(level("gpt-6.1"), 0.5);
  assert.equal(level("gpt-6.1-codex"), 0.5);
  assert.equal(level("gpt-6.1-codex-max"), 1);
  assert.equal(level("gpt-6.1-sol"), 1);
  // A word inside another is not a tier: "solar" is not "sol".
  assert.equal(level("solar-2"), null);
  assert.equal(level("llama-4"), null);
  assert.equal(level(null), null);
});

test("effortLevel ranks an effort", () => {
  assert.deepEqual(["low", "medium", "high", "xhigh", "max", "XHigh", "minimal", "32000", null].map(effortLevel), [0, 0.25, 0.5, 0.75, 1, 0.75, 0, null, null]);
});
