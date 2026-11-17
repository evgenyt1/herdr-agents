import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME, COLUMNS, MIN_WIDTH, MAX_WIDTH, clampWidth, parseWidths, sized, dragged, tableWidth, parseShown, shownKeys, parseSize } from "../mods/herdr-agents/lib/columns.js";

test("the columns stand in the agreed order, after the agent's name", () => {
  assert.equal(NAME.label, "agent");
  assert.deepEqual(COLUMNS.map((column) => column.label), ["status", "model/effort", "ctx", "7d", "tab", "dir", "git", "branch", "PR", "CPU", "mem", "5h", "cost"]);
});

test("every column has a key and a width of its own within the bounds", () => {
  const all = [NAME, ...COLUMNS];
  assert.equal(new Set(all.map((column) => column.key)).size, all.length);
  for (const column of all) assert.ok(column.width >= (column.min ?? MIN_WIDTH) && column.width <= MAX_WIDTH, column.key);
});

test("clampWidth keeps a width whole and within bounds", () => {
  assert.deepEqual([10, MIN_WIDTH, 99.6, 5000].map((width) => clampWidth(width)), [MIN_WIDTH, MIN_WIDTH, 100, MAX_WIDTH]);
  assert.equal(clampWidth(40, 120), 120);
});

test("parseWidths reads what was stored and drops what it cannot use", () => {
  assert.deepEqual(parseWidths('{"dir": 220, "git": 60, "name": 410}'), { name: 410, dir: 220, git: 60 });
  assert.deepEqual(parseWidths('{"dir": 2, "nope": 90, "git": "wide", "tab": 4000, "pr": null, "name": 10}'), { name: NAME.min, tab: MAX_WIDTH, dir: MIN_WIDTH });
  assert.deepEqual(parseWidths("not json"), {});
  assert.deepEqual(parseWidths("[1, 2]"), {});
  assert.deepEqual(parseWidths(null), {});
});

test("sized gives the columns their stored widths", () => {
  const columns = sized(COLUMNS, { dir: 220 });
  assert.equal(columns.find((column) => column.key === "dir").width, 220);
  assert.equal(columns.find((column) => column.key === "git").width, COLUMNS.find((column) => column.key === "git").width);
  assert.equal(columns.length, COLUMNS.length);
  // The table itself is not changed.
  assert.notEqual(COLUMNS.find((column) => column.key === "dir").width, 220);
});

test("dragged: a column's right divider moved right makes it wider", () => {
  assert.equal(dragged(150, 30), 180);
  assert.equal(dragged(150, -30.4), 120);
  assert.equal(dragged(150, -500), MIN_WIDTH);
  assert.equal(dragged(150, 5000), MAX_WIDTH);
  // The name has a least width of its own.
  assert.equal(dragged(230, -500, NAME.min), NAME.min);
});

test("with every column at its own width the table fits a 1400 px block", () => {
  assert.ok(28 + tableWidth(NAME.width, COLUMNS, 12) <= 1400);
});

test("tableWidth adds the name, the columns and the gaps before them", () => {
  assert.equal(tableWidth(300, [], 12), 300);
  assert.equal(tableWidth(300, [{ width: 82 }, { width: 124 }], 12), 300 + 12 + 82 + 12 + 124);
});

test("parseShown reads the stored column keys", () => {
  assert.deepEqual(parseShown('["status", "pr", "nope", 7]'), ["status", "pr"]);
  assert.deepEqual(parseShown('{"status": true}'), []);
  assert.deepEqual(parseShown("not json"), []);
  assert.deepEqual(parseShown(null), []);
});

test("shownKeys: a column nobody has anything for is left out, in display order", () => {
  assert.deepEqual(shownKeys(["cpu", "status", "dir"], [], false), ["status", "dir", "cpu"]);
  assert.deepEqual(shownKeys([], [], false), []);
});

test("shownKeys: just opened, the columns of the last time stay, so none comes in later", () => {
  // Telemetry and pull requests have not been read yet: their columns stand there empty.
  assert.deepEqual(shownKeys(["status", "tab"], ["status", "model", "context", "tab", "pr"], true), ["status", "model", "context", "tab", "pr"]);
  // A column that is new this time still shows at once.
  assert.deepEqual(shownKeys(["status", "git"], ["status", "pr"], true), ["status", "git", "pr"]);
  // Once the readings are in, a column that stayed empty goes.
  assert.deepEqual(shownKeys(["status", "tab"], ["status", "model", "context", "tab", "pr"], false), ["status", "tab"]);
});

test("parseSize reads a stored size, or nothing", () => {
  assert.deepEqual(parseSize('{"width": 1380.5, "height": 757, "extra": 1}'), { width: 1380.5, height: 757 });
  assert.equal(parseSize('{"width": 0, "height": 757}'), null);
  assert.equal(parseSize('{"width": "wide", "height": 757}'), null);
  assert.equal(parseSize("null"), null);
  assert.equal(parseSize("not json"), null);
  assert.equal(parseSize(null), null);
});
