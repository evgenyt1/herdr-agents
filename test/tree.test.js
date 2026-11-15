import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, isAgent, rowStatus, splitAddress } from "../mods/herdr-agents/lib/tree.js";

const agent = (address, more = {}) => ({ address, state: "live", status: "idle", program: { agent: true }, created_ms: 0, ...more });
const listed = (address, space, more = {}) => ({ address, space, space_name: space, tab: `${space}-tab`, tab_index: 1, tab_name: "1", status: "idle", ...more });
const shape = (tree) => tree.groups.map((group) => [group.name, group.rows.map((row) => `${"  ".repeat(row.depth)}${row.address}`)]);

test("splitAddress separates the machine", () => {
  assert.deepEqual(splitAddress("t7"), { machine: null, id: "t7" });
  assert.deepEqual(splitAddress("vps/t7"), { machine: "vps", id: "t7" });
});

test("isAgent: live, and reporting a status or a known agent program", () => {
  assert.equal(isAgent(agent("t1")), true);
  assert.equal(isAgent({ address: "t1", state: "live", status: "working", program: { agent: false } }), true);
  assert.equal(isAgent({ address: "t1", state: "live", status: null, program: { agent: true } }), true);
  assert.equal(isAgent({ address: "t1", state: "live", status: null, program: { agent: false, shell: true } }), false);
  assert.equal(isAgent(agent("t1", { state: "finished" })), false);
});

test("rowStatus: Herdr's word wins; raw error is blocked, raw done is idle", () => {
  assert.equal(rowStatus({ status: "working" }, "done"), "done");
  assert.equal(rowStatus({ status: "error" }), "blocked");
  assert.equal(rowStatus({ status: "done" }), "idle");
  assert.equal(rowStatus({ status: "working" }), "working");
  assert.equal(rowStatus({ status: null }), "unknown");
});

test("children are indented under their parent, in the parent's group, oldest first", () => {
  const terminals = [
    agent("t1"),
    agent("t3", { parent: "t1", created_ms: 30 }),
    agent("t2", { parent: "t1", created_ms: 20 }),
    agent("t4", { parent: "t2", created_ms: 40 }),
    agent("t5"),
  ];
  const agents = [listed("t5", "b"), listed("t1", "a")];
  const spaces = [{ id: "a", index: 1, name: "alpha" }, { id: "b", index: 2, name: "beta" }];
  const tree = buildTree(terminals, agents, spaces);
  assert.deepEqual(shape(tree), [["alpha", ["t1", "  t2", "    t4", "  t3"]], ["beta", ["t5"]]]);
  assert.deepEqual(tree.rows.map((row) => row.guides), [[], ["tee"], ["pipe", "elbow"], ["elbow"], []]);
  assert.equal(tree.rows[0].kids, 2);
});

test("a plain program between two agents is skipped, a finished parent frees its children", () => {
  const terminals = [
    agent("t1"),
    { address: "t2", state: "live", status: null, program: { agent: false }, parent: "t1" },
    agent("t3", { parent: "t2" }),
    agent("t4", { parent: "t9" }),
    agent("t5", { state: "finished" }),
    agent("t6", { parent: "t5" }),
  ];
  const tree = buildTree(terminals);
  assert.deepEqual(tree.rows.map((row) => [row.address, row.depth]), [["t1", 0], ["t3", 1], ["t4", 0], ["t6", 0]]);
});

test("a parent loop does not hang", () => {
  const terminals = [
    { address: "t1", state: "live", status: null, program: {}, parent: "t2" },
    { address: "t2", state: "live", status: null, program: {}, parent: "t1" },
    agent("t3", { parent: "t1" }),
  ];
  assert.deepEqual(buildTree(terminals).rows.map((row) => row.address), ["t3"]);
});

test("folding hides the children and counts them", () => {
  const terminals = [agent("t1"), agent("t2", { parent: "t1" }), agent("t3", { parent: "t2" }), agent("t4")];
  const tree = buildTree(terminals, [], [], new Set(["t1"]));
  assert.deepEqual(tree.rows.map((row) => row.address), ["t1", "t4"]);
  assert.equal(tree.rows[0].folded, true);
  assert.deepEqual(tree.rows[0].hidden, ["idle", "idle"]);
  const urgent = buildTree([agent("t1"), agent("t2", { parent: "t1", status: "error" }), agent("t3", { parent: "t2", status: "working" })], [], [], new Set(["t1"]));
  assert.deepEqual(urgent.rows[0].hidden, ["blocked", "working"]);
});

test("status and place: listed agents use Herdr's, the rest their labels", () => {
  const terminals = [
    agent("t1", { status: "done" }),
    agent("t2", { status: "done", parent: "t1", labels: { "herdr.space": "a", "herdr.tab": "a2" } }),
  ];
  const agents = [listed("t1", "a", { status: "done", tab_name: "lead" })];
  const spaces = [{ id: "a", index: 1, name: "alpha", tabs: [{ id: "a2", name: "2", index: 2 }] }];
  const [lead, kid] = buildTree(terminals, agents, spaces).rows;
  assert.equal(lead.status, "done");
  assert.equal(lead.tab.name, "lead");
  assert.equal(kid.status, "idle");
  assert.deepEqual(kid.tab, { id: "a2", name: "2", index: 2 });
  assert.equal(kid.space, "a");
});

test("other machines: their own groups, labels get the machine's prefix", () => {
  const terminals = [
    agent("t1"),
    agent("vps/t1", { labels: { "herdr.space": "s9" } }),
    agent("vps/t2", { parent: "vps/t1" }),
    agent("box/t1"),
  ];
  const spaces = [{ id: "vps/s9", index: 2, name: "api", machine: "vps" }];
  const tree = buildTree(terminals, [], spaces);
  assert.deepEqual(tree.groups.map((group) => [group.name, group.machine, group.rows.map((row) => row.address)]), [
    ["api", "vps", ["vps/t1", "vps/t2"]],
    ["", null, ["t1"]],
    ["box", "box", ["box/t1"]],
  ]);
  assert.equal(tree.rows[0].machine, "vps");
  assert.equal(tree.rows[0].id, "t1");
});

test("agents that name each other as parent still show: the oldest becomes the root", () => {
  const terminals = [
    agent("t1", { parent: "t2", created_ms: 10 }),
    agent("t2", { parent: "t1", created_ms: 20 }),
    agent("t3", { parent: "t1", created_ms: 30 }),
    agent("t4", { created_ms: 40 }),
  ];
  assert.deepEqual(buildTree(terminals).rows.map((row) => [row.address, row.depth]), [["t1", 0], ["t2", 1], ["t3", 1], ["t4", 0]]);
});

test("a terminal without a pane or labels is where the terminal that started it is", () => {
  const terminals = [
    agent("t1"),
    agent("t2", { parent: "t1" }),
    { address: "t3", state: "live", status: null, program: { agent: false }, labels: { "herdr.space": "b", "herdr.tab": "b1" } },
    agent("t4", { parent: "t3" }),
  ];
  const agents = [listed("t1", "a", { tab_name: "lead" })];
  const spaces = [{ id: "a", index: 1, name: "alpha" }, { id: "b", index: 2, name: "beta", tabs: [{ id: "b1", name: "shell", index: 1 }] }];
  const tree = buildTree(terminals, agents, spaces);
  const kid = tree.rows.find((row) => row.address === "t2");
  assert.equal(kid.space, "a");
  assert.equal(kid.tab.name, "lead");
  assert.deepEqual(tree.groups.map((group) => [group.name, group.rows.map((row) => row.address)]), [["alpha", ["t1", "t2"]], ["beta", ["t4"]]]);
  assert.equal(tree.rows.find((row) => row.address === "t4").tab.name, "shell");
});

test("groups follow the order of spaces(), whatever their index says", () => {
  const terminals = [agent("t1"), agent("vps/t1"), agent("t2")];
  const agents = [listed("t1", "one"), listed("vps/t1", "vps/one"), listed("t2", "two")];
  const spaces = [{ id: "one", index: 1, name: "one" }, { id: "two", index: 2, name: "two" }, { id: "vps/one", index: 1, name: "remote", machine: "vps" }];
  assert.deepEqual(buildTree(terminals, agents, spaces).groups.map((group) => group.name), ["one", "two", "remote"]);
});

test("a terminal hanging off a parent loop stays under its parent", () => {
  // t1 is the oldest and names t2; t2 and t3 name each other.
  const terminals = [
    agent("t1", { parent: "t2", created_ms: 10 }),
    agent("t2", { parent: "t3", created_ms: 20 }),
    agent("t3", { parent: "t2", created_ms: 30 }),
  ];
  assert.deepEqual(buildTree(terminals).rows.map((row) => [row.address, row.depth]), [["t2", 0], ["t1", 1], ["t3", 1]]);
});
