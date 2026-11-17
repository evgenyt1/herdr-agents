import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DIR_SCRIPT, NO_PID_LIVE_MS, telemetryDir, isTelemetryFile, parseTelemetry, matchTelemetry, shortModel, modelEffort, limitPercent } from "../mods/herdr-agents/lib/telemetry.js";
import { parsePs } from "../mods/herdr-agents/lib/ps.js";

const FULL = {
  v: 1,
  agent: "claude",
  agentVersion: "2.1.325",
  session: "0b7c2f3e",
  pid: 97127,
  cwd: "/home/me/src/app",
  terminal: { hc: "t24" },
  model: "claude-opus-5-5",
  effort: "high",
  state: "working",
  context: { used: 68224, window: 1000000, percent: 7 },
  limits: [
    { kind: "five_hour", percent: 23.5, resetsAt: "2026-11-15T20:00:00Z" },
    { kind: "seven_day", percent: 41, resetsAt: "2026-11-20T09:00:00Z" },
  ],
  cost: { usd: 4.12 },
  startedAt: "2026-11-15T15:12:19Z",
  updatedAt: "2026-11-15T15:40:02Z",
};
const file = (more) => parseTelemetry(JSON.stringify({ ...FULL, ...more }));

test("the folder: AGENT_TELEMETRY_DIR, else XDG_CACHE_HOME, else ~/.cache", () => {
  assert.equal(telemetryDir({ AGENT_TELEMETRY_DIR: "/x", XDG_CACHE_HOME: "/c" }, "/home/me"), "/x");
  assert.equal(telemetryDir({ XDG_CACHE_HOME: "/c" }, "/home/me"), "/c/agent-telemetry");
  assert.equal(telemetryDir({}, "/home/me/"), "/home/me/.cache/agent-telemetry");
});

test("the shell script follows the same rule", { skip: process.platform === "win32" }, () => {
  const run = (env) => execFileSync("sh", ["-c", DIR_SCRIPT], { env: { PATH: process.env.PATH, HOME: "/home/me", ...env }, encoding: "utf8" });
  for (const env of [{ AGENT_TELEMETRY_DIR: "/x", XDG_CACHE_HOME: "/c" }, { XDG_CACHE_HOME: "/c" }, {}]) {
    assert.equal(run(env), telemetryDir(env, "/home/me"));
  }
});

test("file names: session files yes, temporary and other files no", () => {
  assert.equal(isTelemetryFile("claude-0b7c.json"), true);
  assert.equal(isTelemetryFile(".claude-0b7c.json.tmp"), false);
  assert.equal(isTelemetryFile(".hidden.json"), false);
  assert.equal(isTelemetryFile("claude-0b7c.json.tmp"), false);
  assert.equal(isTelemetryFile("notes.txt"), false);
  assert.equal(isTelemetryFile(""), false);
});

test("parseTelemetry reads a full v1 file", () => {
  assert.deepEqual(parseTelemetry(JSON.stringify(FULL)), {
    agent: "claude",
    session: "0b7c2f3e",
    pid: 97127,
    cwd: "/home/me/src/app",
    hc: "t24",
    model: "claude-opus-5-5",
    effort: "high",
    state: "working",
    context: { used: 68224, window: 1000000, percent: 7 },
    limits: [
      { kind: "five_hour", percent: 23.5, resetsAt: Date.parse("2026-11-15T20:00:00Z") },
      { kind: "seven_day", percent: 41, resetsAt: Date.parse("2026-11-20T09:00:00Z") },
    ],
    cost: 4.12,
    startedAt: Date.parse("2026-11-15T15:12:19Z"),
    updatedAt: Date.parse("2026-11-15T15:40:02Z"),
  });
});

test("parseTelemetry skips unknown versions, half files and files with nothing to match by", () => {
  assert.equal(file({ v: 2 }), null);
  assert.equal(file({ v: "1" }), null);
  assert.equal(file({ pid: undefined, terminal: undefined }), null);
  assert.equal(file({ pid: undefined, terminal: { tmux: "%3" } }), null);
  assert.equal(file({ pid: "97127", terminal: {} }), null);
  assert.equal(parseTelemetry('{"v":1,"pid":'), null);
  assert.equal(parseTelemetry("[]"), null);
  assert.equal(parseTelemetry("null"), null);
  assert.equal(parseTelemetry(""), null);
});

test("parseTelemetry: optional fields may be absent or odd, unknown fields are ignored", () => {
  const bare = parseTelemetry(JSON.stringify({ v: 1, agent: "codex", session: "s", pid: 5, cwd: "/w", startedAt: "x", updatedAt: "y", extra: { deep: true } }));
  assert.deepEqual(bare, { agent: "codex", session: "s", pid: 5, cwd: "/w", hc: null, model: null, effort: null, state: null, context: null, limits: [], cost: null, startedAt: null, updatedAt: null });
  assert.equal(file({ effort: 3 }).effort, "3");
  assert.deepEqual(file({ context: { window: 200000 } }).context, { used: null, window: 200000, percent: null });
  assert.equal(file({ context: { used: 50000, window: 200000 } }).context.percent, 25);
  assert.deepEqual(file({ limits: [{ kind: "five_hour" }, { percent: 5 }, null, { kind: "90m", percent: 12 }] }).limits, [{ kind: "90m", percent: 12, resetsAt: null }]);
  assert.equal(file({ limits: "none" }).limits.length, 0);
  assert.equal(file({ terminal: { tmux: "%3" } }).hc, null);
  // The pid is optional: absent while the writer cannot find it.
  assert.deepEqual([file({ pid: undefined }).pid, file({ pid: undefined }).hc], [null, "t24"]);
  assert.equal(file({ pid: 0 }).pid, null);
  assert.equal(file({ pid: 12.5 }).pid, null);
  assert.equal(file({ cost: {} }).cost, null);
});

// Two terminals: t1 runs a shell (10) with the agent (11) in front; t2's agent (20) has a helper (21).
const PROCS = parsePs("10 1 0 1\n11 10 0 1\n12 11 0 1\n20 1 0 1\n21 20 0 1\n30 1 0 1\n");
const TERMS = [
  { address: "t1", id: "t1", pids: [11, 10] },
  { address: "t2", id: "t2", pids: [20, 20] },
];
const rec = (pid, hc, more = {}) => ({ pid, hc, updatedAt: 0, ...more });

test("matchTelemetry: the hc id decides first", () => {
  const found = matchTelemetry(TERMS, [rec(30, "t2"), rec(11, null)], PROCS);
  assert.equal(found.get("t2").pid, 30);
  assert.equal(found.get("t1").pid, 11);
});

test("matchTelemetry: without an hc id, the pid or a process above it", () => {
  const found = matchTelemetry(TERMS, [rec(12, null), rec(21, null)], PROCS);
  assert.equal(found.get("t1").pid, 12);
  assert.equal(found.get("t2").pid, 21);
  assert.equal(matchTelemetry(TERMS, [rec(30, null)], PROCS).size, 0);
  assert.equal(matchTelemetry(TERMS, [rec(30, "t9")], PROCS).size, 0);
});

test("matchTelemetry: a file whose pid is not running is skipped", () => {
  assert.equal(matchTelemetry(TERMS, [rec(99, "t1")], PROCS).size, 0);
});

test("matchTelemetry: several files for one terminal: nearest the foreground program, then newest", () => {
  const nested = matchTelemetry(TERMS, [rec(12, "t1", { updatedAt: 9 }), rec(11, "t1", { updatedAt: 1 })], PROCS);
  assert.equal(nested.get("t1").pid, 11);
  const stale = matchTelemetry(TERMS, [rec(30, "t2", { updatedAt: 1, session: "old" }), rec(30, "t2", { updatedAt: 5, session: "new" })], PROCS);
  assert.equal(stale.get("t2").session, "new");
});

test("matchTelemetry without a process table: nothing is called dead, pids match exactly", () => {
  const found = matchTelemetry(TERMS, [rec(99, "t1"), rec(20, null), rec(21, null)], null);
  assert.equal(found.get("t1").pid, 99);
  assert.equal(found.get("t2").pid, 20);
  assert.equal(matchTelemetry(TERMS, undefined, null).size, 0);
});

test("matchTelemetry: a file without a pid matches by its hc id, while it is not old", () => {
  const now = 1_000_000_000;
  const fresh = rec(null, "t1", { updatedAt: now - 60_000, session: "no-pid" });
  assert.equal(matchTelemetry(TERMS, [fresh], PROCS, now).get("t1").session, "no-pid");
  assert.equal(matchTelemetry(TERMS, [fresh], null, now).get("t1").session, "no-pid");
  assert.equal(matchTelemetry(TERMS, [rec(null, "t1", { updatedAt: now - NO_PID_LIVE_MS - 1 })], PROCS, now).size, 0);
  // No time at all: nothing says it is old.
  assert.equal(matchTelemetry(TERMS, [rec(null, "t1", { updatedAt: null })], PROCS, now).size, 1);
  assert.equal(matchTelemetry(TERMS, [rec(null, "t1", { updatedAt: null, startedAt: now - NO_PID_LIVE_MS - 1 })], PROCS, now).size, 0);
  assert.equal(matchTelemetry(TERMS, [rec(null, "t9", { updatedAt: now })], PROCS, now).size, 0);
  // A file that knows its pid, in that terminal, is the better claim even when older.
  const both = matchTelemetry(TERMS, [rec(null, "t1", { updatedAt: now }), rec(11, "t1", { updatedAt: now - 5000, session: "with-pid" })], PROCS, now);
  assert.equal(both.get("t1").session, "with-pid");
});

test("matchTelemetry: a file written before the terminal was made is not that terminal's", () => {
  const terms = [{ address: "t1", id: "t1", pids: [11, 10], created: 5000 }, { address: "t2", id: "t2", pids: [20, 20], created: 5000 }];
  // The id was given out again: the old session's file names t1, and its time says it is older.
  assert.equal(matchTelemetry(terms, [rec(null, "t1", { updatedAt: 4000 })], PROCS, 6000).size, 0);
  assert.equal(matchTelemetry(terms, [rec(null, "t1", { updatedAt: 5500 })], PROCS, 6000).size, 1);
  // A live process still counts where it runs, whatever id the file carries.
  const moved = matchTelemetry(terms, [rec(21, "t1", { updatedAt: 4000 })], PROCS, 6000);
  assert.deepEqual([...moved.keys()], ["t2"]);
  assert.equal(matchTelemetry(terms, [rec(30, "t1", { updatedAt: 4000 })], PROCS, 6000).size, 0);
});

test("column helpers", () => {
  assert.equal(shortModel("claude-opus-5-5"), "opus-5.5");
  assert.equal(shortModel("claude-sonnet-5-5-20261001"), "sonnet-5.5");
  assert.equal(shortModel("claude-opus-5-5[1m]"), "opus-5.5[1m]");
  assert.equal(shortModel("claude-opus-5"), "opus-5");
  assert.equal(shortModel("claude-3-5-sonnet-20241022"), "3-5-sonnet");
  // A date written with dashes is a stamp too, not a version.
  assert.equal(shortModel("gpt-5-2025-08-07"), "gpt-5");
  assert.equal(shortModel("gpt-4o-2024-08-06"), "gpt-4o");
  assert.equal(shortModel("claude-opus-4-1-20250805"), "opus-4.1");
  assert.equal(shortModel("gpt-6.1-sol"), "gpt-6.1-sol");
  assert.equal(shortModel(null), "");
  // A month and a day at the end are not a version.
  assert.equal(shortModel("gemini-2.5-pro-preview-06-05"), "gemini-2.5-pro-preview-06-05");
  assert.equal(shortModel("claude-opus-4-10"), "opus-4.10");
  assert.equal(modelEffort({ model: "claude-opus-5-5", effort: "xhigh" }), "opus-5.5/xhigh");
  assert.equal(modelEffort({ model: "claude-opus-5-5", effort: null }), "opus-5.5");
  assert.equal(modelEffort({ model: null, effort: "high" }), "high");
  assert.equal(modelEffort(null), "");
  const before = Date.parse("2026-11-15T19:59:59Z");
  assert.equal(limitPercent(file({}), "five_hour", before), 23.5);
  assert.equal(limitPercent(file({}), "five_hour", before + 1000), null); // the window has reset
  assert.equal(limitPercent(file({}), "seven_day", before + 1000), 41);
  assert.equal(limitPercent(file({ limits: [{ kind: "five_hour", percent: 9 }] }), "five_hour", before), 9);
  assert.equal(limitPercent(file({}), "spend_limit", before), null);
  assert.equal(limitPercent(null, "five_hour", before), null);
});
