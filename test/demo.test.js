import { test } from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../mods/herdr-agents/demo.js";
import { buildTree } from "../mods/herdr-agents/lib/tree.js";
import { matchTelemetry } from "../mods/herdr-agents/lib/telemetry.js";
import { treeUsage } from "../mods/herdr-agents/lib/ps.js";

test("the demo is a whole picture: a tree, two machines, every status, telemetry for some", () => {
  const demo = demoData();
  const tree = buildTree(demo.terminals, demo.agents, demo.spaces);
  assert.deepEqual(tree.groups.map((group) => [group.name, group.machine, group.rows.map((row) => `${row.depth}:${row.address}`)]), [
    ["webshop", null, ["0:t1", "1:t2", "2:t3", "1:t4", "1:t5", "0:t6"]],
    ["notes", null, ["0:t7"]],
    ["api", "vps", ["0:vps/t2", "1:vps/t3"]],
  ]);
  assert.deepEqual([...new Set(tree.rows.map((row) => row.status))].sort(), ["blocked", "done", "idle", "working"]);
  for (const machine of ["", "vps"]) {
    const rows = tree.rows.filter((row) => (row.machine ?? "") === machine);
    const terminals = rows.map((row) => ({ address: row.address, id: row.id, pids: [row.terminal.foreground.pid, row.terminal.pid] }));
    const found = matchTelemetry(terminals, demo.records.get(machine), demo.procs.get(machine));
    assert.equal(found.size, demo.records.get(machine).length);
    for (const row of rows) assert.ok(treeUsage(demo.procs.get(machine), row.terminal.foreground.pid), row.address);
    for (const row of rows) assert.ok(demo.repos.has(`${machine}\n${row.terminal.foreground.cwd}`) || row.address === "t7", row.address);
  }
});
