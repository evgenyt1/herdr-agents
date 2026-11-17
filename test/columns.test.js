import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNS, MIN_WIDTH, MAX_WIDTH, clampWidth, parseWidths, fitted, dragged } from "../mods/herdr-agents/lib/columns.js";

test("the columns stand in the agreed order", () => {
  assert.deepEqual(COLUMNS.map((column) => column.label), ["status", "model/effort", "ctx", "7d", "tab", "dir", "git", "branch", "PR", "CPU", "mem", "5h", "cost"]);
});

test("every column has a key, a width and a rank of its own", () => {
  assert.equal(new Set(COLUMNS.map((column) => column.key)).size, COLUMNS.length);
  assert.deepEqual(COLUMNS.map((column) => column.rank).sort((a, b) => a - b), COLUMNS.map((_, index) => index + 1));
  for (const column of COLUMNS) assert.ok(column.width >= MIN_WIDTH && column.width <= MAX_WIDTH, column.key);
});

const keys = (columns) => columns.map((column) => column.key);

test("a narrow table keeps status, model, ctx and 7d longest", () => {
  const room = COLUMNS.filter((column) => column.rank <= 4).reduce((sum, column) => sum + column.width + 12, -12);
  assert.deepEqual(keys(fitted(COLUMNS, {}, room, 12)), ["status", "model", "context", "seven"]);
  assert.deepEqual(keys(fitted(COLUMNS, {}, room - 1, 12)), ["status", "model", "context"]);
  assert.deepEqual(keys(fitted(COLUMNS, {}, 10000, 12)), keys(COLUMNS));
  assert.deepEqual(fitted(COLUMNS, {}, 10, 12), []);
});

test("clampWidth keeps a width whole and within bounds", () => {
  assert.deepEqual([10, MIN_WIDTH, 99.6, 5000].map(clampWidth), [MIN_WIDTH, MIN_WIDTH, 100, MAX_WIDTH]);
});

test("parseWidths reads what was stored and drops what it cannot use", () => {
  assert.deepEqual(parseWidths('{"dir": 220, "git": 60}'), { dir: 220, git: 60 });
  assert.deepEqual(parseWidths('{"dir": 2, "nope": 90, "git": "wide", "tab": 4000, "pr": null}'), { dir: MIN_WIDTH, tab: MAX_WIDTH });
  assert.deepEqual(parseWidths("not json"), {});
  assert.deepEqual(parseWidths("[1, 2]"), {});
  assert.deepEqual(parseWidths(null), {});
});

test("fitted gives the columns the widths a person gave them", () => {
  const columns = fitted(COLUMNS, { dir: 220 }, 10000, 12);
  assert.equal(columns.find((column) => column.key === "dir").width, 220);
  assert.equal(columns.find((column) => column.key === "git").width, COLUMNS.find((column) => column.key === "git").width);
  // The table itself is not changed.
  assert.notEqual(COLUMNS.find((column) => column.key === "dir").width, 220);
});

test("fitted: a width set in a wide block does not hide the column in a narrow one", () => {
  // 330 px: status, model, ctx and 7d at their own widths.
  assert.deepEqual(fitted(COLUMNS, { model: 480 }, 330, 12).map((column) => [column.key, column.width]), [["status", 82], ["model", 124], ["context", 38], ["seven", 36]]);
  assert.deepEqual(fitted(COLUMNS, { status: 400 }, 330, 12).map((column) => [column.key, column.width]), [["status", 82], ["model", 124], ["context", 38], ["seven", 36]]);
  // Where it fits, the given width stands, and the columns after it get what is left.
  assert.deepEqual(fitted(COLUMNS, { model: 200 }, 330, 12).map((column) => [column.key, column.width]), [["status", 82], ["model", 200]]);
});

test("dragged: a column's left border moved left makes it wider", () => {
  assert.equal(dragged(150, -30), 180);
  assert.equal(dragged(150, 30.4), 120);
  assert.equal(dragged(150, 500), MIN_WIDTH);
  assert.equal(dragged(150, -5000), MAX_WIDTH);
});
