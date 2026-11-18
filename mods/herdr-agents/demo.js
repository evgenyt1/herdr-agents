// Made-up agents for `props: { demo: true }`: every status, a tree, another machine, telemetry.
// Lets the mod be looked at (and its preview be drawn) without running anything.

import { parsePs } from "./lib/ps.js";

// Pictures (claude, codex) are drawn as they are; a one-color glyph (pi) takes the text color.
const program = (key, name) => ({ key, name, icon: `icons/${key}.svg`, tint: key === "pi", tile: null, color: null, shell: false, agent: true });
const CLAUDE = program("claude", "Claude Code");
const CODEX = program("codex", "Codex");
const PI = program("pi", "pi");

let born = 1_700_000_000_000;
const terminal = (address, pid, cwd, more = {}) => ({
  address,
  state: "live",
  status: "idle",
  name: null,
  title: "",
  parent: null,
  labels: {},
  program: CLAUDE,
  pid,
  foreground: { pid, cwd },
  cwd,
  created_ms: (born += 1000),
  report: null,
  ...more,
});

const listed = (address, space, space_name, tab_index, tab_name, status, more = {}) => ({
  address,
  pane: `pane-${address}`,
  space,
  space_name,
  tab: `${space}-tab${tab_index}`,
  tab_index,
  tab_name,
  status,
  focused: false,
  ...more,
});

const record = (pid, hc, model, effort, percent, cost, limits = [23.5, 41]) => ({
  agent: model.startsWith("claude") ? "claude" : "codex",
  session: `demo-${pid}`,
  pid,
  cwd: null,
  hc,
  model,
  effort,
  state: null,
  context: { used: percent * 10000, window: 1000000, percent },
  limits: [
    { kind: "five_hour", percent: limits[0], resetsAt: null },
    { kind: "seven_day", percent: limits[1], resetsAt: null },
  ],
  cost,
  startedAt: null,
  updatedAt: 1_700_000_100_000,
});

// What changed in a checkout, as `parseStatus` gives it.
const status = (branch, upstream, counts = {}) => ({ branch, upstream, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0, ...counts });

const repo = (repoName, worktree, branch, counts) => ({
  repo: { top: `/home/dev/src/${worktree ? `${repoName}-worktrees/${worktree}` : repoName}`, common: `/home/dev/src/${repoName}/.git`, repo: repoName, worktree, below: "" },
  branch,
  status: status(branch, `origin/${branch}`, counts),
});

export function demoData() {
  const shop = "/home/dev/src/webshop";
  const tree = (name) => `/home/dev/src/webshop-worktrees/${name}`;
  const api = "/srv/api";
  const terminals = [
    terminal("t1", 4100, shop, { status: "working", title: "Checkout redesign", report: { msg: "Waiting on three helpers" } }),
    terminal("t2", 4200, tree("cart-totals"), { status: "working", name: "cart-totals", parent: "t1", title: "Cart totals rounding" }),
    terminal("t3", 4300, tree("cart-totals"), { status: "done", name: "review", parent: "t2", program: CODEX, title: "Review cart totals" }),
    terminal("t4", 4400, tree("payment-form"), { status: "blocked", name: "payment-form", parent: "t1", title: "Allow network access?" }),
    terminal("t5", 4500, tree("email-receipts"), { status: "done", name: "email-receipts", parent: "t1", title: "Receipt template" }),
    terminal("t6", 4600, shop, { status: "done", title: "Flaky search test", program: PI }),
    terminal("t7", 4700, "/home/dev/notes", { status: "idle", title: "Weekly notes" }),
    terminal("vps/t2", 900, api, { status: "working", title: "Rate limiter", report: { msg: "Running the load test" } }),
    terminal("vps/t3", 950, `${api}/migrations`, { status: "idle", name: "migrate", parent: "vps/t2", program: CODEX }),
  ];
  const agents = [
    listed("t1", "s1", "webshop", 1, "lead", "working", { focused: true }),
    listed("t2", "s1", "webshop", 2, "2", "working"),
    listed("t4", "s1", "webshop", 3, "3", "blocked"),
    listed("t6", "s1", "webshop", 4, "search", "done"),
    listed("t7", "s2", "notes", 1, "1", "idle"),
    listed("vps/t2", "vps/s1", "api", 1, "1", "working"),
  ];
  const spaces = [
    { id: "s1", index: 1, name: "webshop", machine: null, tabs: [] },
    { id: "s2", index: 2, name: "notes", machine: null, tabs: [] },
    { id: "vps/s1", index: 3, name: "api", machine: "vps", tabs: [] },
  ];
  const procs = new Map([
    ["", parsePs("4100 1 3.1 412000\n4110 4100 0.4 90000\n4200 1 38.5 655000\n4210 4200 61.0 1240000\n4300 1 0.0 180000\n4400 1 0.2 388000\n4500 1 0.0 296000\n4600 1 0.0 151000\n4700 1 0.0 240000\n")],
    ["vps", parsePs("900 1 12.4 520000\n901 900 88.0 2100000\n950 1 0.0 140000\n")],
  ]);
  const records = new Map([
    ["", [
      record(4100, "t1", "claude-opus-5-5", "high", 37, 6.42),
      record(4200, "t2", "claude-opus-5-5", "medium", 62, 2.18),
      record(4300, "t3", "gpt-6.1-sol", "high", 18, null),
      record(4400, "t4", "claude-sonnet-5-5", "low", 86, 0.74),
      record(4500, "t5", "claude-sonnet-5-5", "low", 44, 0.31),
    ]],
    ["vps", [record(900, "t2", "claude-opus-5-5", "max", 71, 11.9, [64, 82])]],
  ]);
  const rate = status("rate-limit", "origin/rate-limit", { conflicts: 1, modified: 2, ahead: 1, behind: 3 });
  const repos = new Map([
    [`\n${shop}`, repo("webshop", null, "main")],
    [`\n${tree("cart-totals")}`, repo("webshop", "cart-totals", "fix/cart-totals", { staged: 3, modified: 1, ahead: 2 })],
    [`\n${tree("payment-form")}`, repo("webshop", "payment-form", "feat/payment-form", { modified: 5, untracked: 2 })],
    [`\n${tree("email-receipts")}`, repo("webshop", "email-receipts", "feat/email-receipts", { behind: 4 })],
    [`vps\n${api}`, { repo: { top: api, common: `${api}/.git`, repo: "api", worktree: null, below: "" }, branch: "rate-limit", status: rate }],
    [`vps\n${api}/migrations`, { repo: { top: api, common: `${api}/.git`, repo: "api", worktree: null, below: "migrations" }, branch: "rate-limit", status: rate }],
  ]);
  // How ssh reaches the other machine: its folders open in VS Code too.
  const reach = new Map([["vps", { target: "vps", at: 0 }]]);
  const pr = (number, state) => ({ pr: { number, state, url: null, title: "" } });
  const prs = new Map([
    ["\n/home/dev/src/webshop/.git\nfix/cart-totals", pr(128, "open")],
    ["\n/home/dev/src/webshop/.git\nfeat/payment-form", pr(131, "draft")],
    ["\n/home/dev/src/webshop/.git\nfeat/email-receipts", pr(126, "merged")],
    [`vps\n${api}/.git\nrate-limit`, pr(57, "open")],
  ]);
  // The machine the app runs on, for the footer: a laptop on its battery, warm, with macmon.
  const machine = {
    stats: { cores: 12, memory: 36 * 1024 ** 3, load: 7.4, free: 38, pressure: 1, swap: 2.1 * 1024 ** 3, thermal: 1, battery: 64, plugged: false },
    heat: 1,
    level: 1,
    sensors: { clock: 3900, busy: 0.4, degrees: 71, watts: 18, fan: 2400, fanTop: 6000 },
    clockTop: 4500,
  };
  return { terminals, agents, spaces, procs, records, repos, prs, reach, machine, home: "/home/dev" };
}
