// herdr-agents: every agent terminal as a row. Status, the parent tree, where it is, its git
// branch, changes and pull request, CPU and memory; and when agent-telemetry files are present,
// the model, effort, context, limits and cost they report. Nothing here needs telemetry to work.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, Scrollbar } from "gpui-base";
import { agents, terminals, panes, spaces, focused, theme, props, run, exec, hc, home, notify, readTextFile, watchFolder, nextCommand, setAgentOrder, closeOverlay } from "herdr";
import * as fs from "fs/promises";
import { buildTree, isAgent, splitAddress, panedTerminals, goCommand } from "./lib/tree.js";
import { PS_ARGS, parsePs, withRates, coarseTimes, childIndex, treeUsage } from "./lib/ps.js";
import { DIR_SCRIPT, telemetryDir, isTelemetryFile, parseTelemetry, matchTelemetry, shortModel, modelEffort, limitPercent } from "./lib/telemetry.js";
import { REPO_ARGS, STATUS_ARGS, prArgs, parseRepo, parseStatus, statusParts, fitParts, statusText, statusNote, codeArgs, sshTarget, pickPr, folderLabel, tilde } from "./lib/git.js";
import { cpuText, memText, costText, percentText, fitColumns, prText, prNote, countWidth } from "./lib/format.js";
import { NAME, COLUMNS, clampWidth, parseWidths, sized, dragged, tableWidth, parseShown, shownKeys, parseSize } from "./lib/columns.js";
import { heat, percentLevel, modelLevel, effortLevel } from "./lib/colors.js";
import { demoData } from "./demo.js";

// How often things are asked, in ms. Process figures: `refresh` in props (seconds).
const REFRESH_MS = 5000;
const REMOTE_MS = 15000; // processes and telemetry on another machine
const BRANCH_MS = 10000;
const NO_REPO_MS = 60000; // a folder that was not a repository is asked again
const SLOW_GIT = 20; // a status that took a second is asked for again after 20: git stays under 5% of a core
const PLAIN_GIT_MS = 600000; // a git too old for the status asked is tried again
const REACH_MS = 600000; // how a machine is reached (for VS Code) is asked again
const PR_FOUND_MS = 120000;
const PR_NONE_MS = 300000;
const PR_RUN_MS = 60000; // one round of gh calls takes no longer; the rest wait for the next
const PR_ASKING_MS = 30000; // a gh call another copy of the mod started is not started again
const GH_RETRY_MS = 600000; // gh is not installed
const GH_AWAY_MS = 60000; // gh could not be reached (the machine is away)
const GIT_AT_ONCE = 6; // folders asked at the same time
const MISSING_DIR_MS = 30000; // the telemetry folder is not there yet
const FORGET_MS = 600000; // cached folders nobody is in any more
const CPU_SPAN_MS = 20000; // CPU is the load over about this long
const CPU_SPAN_COARSE_MS = 60000; // where ps counts CPU time in whole seconds (Linux)
const PUBLISH_MS = 120; // jobs ending close together are drawn once
const JOB_LOST_MS = 120000; // a job that has not come back by then is given up on
const DRAG_IDLE_MS = 4000; // a held divider that has not moved for this long is taken as let go
const GIT_WAIT_MAX_MS = 120000; // however slow git was, a checkout is asked again after this
const HOLD_MS = 60000; // just opened: the columns of the last time stay until the readings are in, this long at most

// Processes, branches and pull requests as read from the machines. Plain data, shared by every
// copy of the mod and kept while the app runs: opened over the window a second time, the
// branches and pull requests are there at once. Keys: a machine's name ("" for this one), alone or in front of a folder.
const newStore = () => ({
  procs: new Map(), // machine -> { table, index, at }
  readings: new Map(), // machine -> [{ at, table }]: the last ps readings, to tell load from them
  procAt: new Map(),
  repos: new Map(), // machine \n cwd -> { repo, branch, status, repoAt, used }
  heads: new Map(), // machine \n checkout -> { branch, status, at, wait, used }
  plainGit: new Map(), // machine -> until when its git is asked for the branch alone
  reach: new Map(), // another machine -> { target, at }: how ssh reaches it, null when it does not
  prs: new Map(), // machine \n git folder \n branch -> { pr, at, asked }
  ghOff: new Map(), // machine -> when to try gh again
  homes: new Map(), // another machine -> its home folder
  tele: new Map(), // telemetry folder as given in props ("": the machine's own) -> { records, files }
  busy: 0, // jobs under way, in all copies together
});
const STORE = newStore();
const URGENCY = { blocked: 4, done: 3, working: 2, idle: 1, unknown: 0 };
// The top bar's counts in display order; in a narrow bar the least urgent go first.
const COUNTED = ["blocked", "working", "done", "idle", "unknown"];
const WORD_WIDTH = 44; // "Agents" in the top bar

const GAP = 12;
const EDGE = 28; // a row's margins and padding, left and right together
const HEAD = 20; // the headings' height
const STATUS_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle", unknown: "" };
// The theme color of each mark in the git column.
const GIT_COLOR = { conflicts: "ansi1", staged: "ansi2", modified: "ansi3", untracked: "ansi4", ahead: "ansi6", behind: "ansi5", clean: "ansi2" };

/** Runs `work` on every item, at most `size` at a time. `work` must not throw. */
async function pool(items, size, work) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}

const cwdOf = (terminal) => terminal?.foreground?.cwd ?? terminal?.cwd ?? null;
const rootPids = (terminal) => [terminal?.foreground?.pid, terminal?.pid].filter((pid) => pid > 0);
// Agents put a spinner or a mark in front of their title; a row has its own.
const plain = (title) => String(title ?? "").replace(/^[\p{S}\s]+/u, "").trim();

function cellText(row, key) {
  switch (key) {
    case "status": return STATUS_WORD[row.status] ?? "";
    case "tab": return row.where;
    case "dir": return row.folder.detail ? `${row.folder.main} › ${row.folder.detail}` : row.folder.main;
    case "git": return statusText(row.git);
    case "branch": return row.branch ?? "";
    case "pr": return prText(row.pr);
    case "cpu": return cpuText(row.usage?.cpu);
    case "mem": return memText(row.usage?.rss);
    case "model": return modelEffort(row.tele);
    case "context": return percentText(row.tele?.context?.percent);
    case "five": return percentText(limitPercent(row.tele, "five_hour"));
    case "seven": return percentText(limitPercent(row.tele, "seven_day"));
    case "cost": return costText(row.tele?.cost);
    default: return "";
  }
}

export default class HerdrAgents extends View {
  init(_props, cx) {
    const given = props() ?? {};
    this.size = this.stored("size", parseSize); // as last time, so the first frame is laid out as the next ones
    this.sizeKept = JSON.stringify(this.size);
    this.laid = false; // whether Herdr has said how big this copy is
    this.opened = Date.now();
    this.settled = false; // whether the first readings are all in
    this.began = false; // whether there was an agent to read anything for
    this.teleRead = false;
    this.folded = new Set();
    this.cursor = null;
    this.here = undefined; // the agent the person is in, as last seen
    this.reveal = null;
    this.lines = [];
    this.widths = {}; // column -> px, as the person dragged them
    this.drag = null; // { key, min, x, width, now, at } while a column's divider is held
    this.fit = null; // { key, turn } while a column is measured to fit what is in it
    this.across = 0; // how wide the table was last drawn
    this.keys = null; // the columns it was last drawn with
    this.turn = 0;
    this.last = null; // the rows as last drawn
    this.loadWidths();
    // The columns shown the last time: they are there from the first frame, before the readings.
    this.remembered = this.stored("shown", parseShown) ?? [];
    this.shownKept = JSON.stringify(this.remembered);
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.running = new Map(); // job -> when it started
    this.data = STORE;
    // Telemetry is kept by folder, as `telemetryDir` in props may point a copy somewhere else:
    // a copy opened again starts from what the last one read, not from nothing.
    const folder = String(given.telemetryDir ?? "");
    if (!STORE.tele.has(folder)) STORE.tele.set(folder, { records: new Map(), files: new Map() });
    this.tele = STORE.tele.get(folder); // records: machine -> telemetry records; files: this machine's, name -> record
    this.asked = new Set(); // pids a process reading was already asked for
    this.pending = false;
    this.teleAt = new Map();
    this.teleDir = new Map();
    this.demo = null;

    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        cx.notify();
      }
    });

    if (given.demo) {
      const demo = demoData();
      this.demo = demo;
      this.data = newStore();
      for (const [machine, table] of demo.procs) this.data.procs.set(machine, { table, index: childIndex(table), at: 0 });
      this.tele = { records: demo.records, files: new Map() };
      this.settled = true;
      this.data.repos = demo.repos;
      this.data.reach = demo.reach;
      this.data.prs = demo.prs;
      return;
    }

    const every = Math.max(2, Number(given.refresh) || REFRESH_MS / 1000) * 1000;
    cx.timer.every(every, (cx) => this.tick(cx));
    this.tick(cx);
    this.watchTelemetry(cx);
  }

  // ---- what is asked of the machines, always in the background ----

  /** The machines and folders the current agents are on. */
  targets() {
    const machines = new Set();
    const folders = new Map();
    for (const terminal of terminals()) {
      if (!isAgent(terminal)) continue;
      const { machine } = splitAddress(terminal.address);
      machines.add(machine);
      const cwd = cwdOf(terminal);
      if (cwd) folders.set(`${machine ?? ""}\n${cwd}`, { machine, cwd });
    }
    return { machines: [...machines], folders: [...folders.values()] };
  }

  /**
   * Runs `body` unless the same job is still going. A body that answers false changed nothing;
   * anything else asks for a redraw.
   */
  job(name, cx, body) {
    const started = Date.now();
    if (started - (this.running.get(name) ?? -Infinity) < JOB_LOST_MS) return;
    this.running.set(name, started);
    const data = this.data;
    data.busy++;
    cx.spawn(async (cx) => {
      let changed = false;
      try {
        changed = (await body(cx)) !== false;
      } catch (error) {
        console.warn(`herdr-agents: ${name}: ${error}`);
      } finally {
        data.busy--;
        if (this.running.get(name) === started) this.running.delete(name);
      }
      if (this.settle() || changed) this.later(cx);
    });
  }

  /**
   * Whether the first readings have just all come in: from here on an empty column goes. A
   * job of this copy that had nothing to do, because another copy is at the same reading,
   * does not count as that reading being in; nor does a round with no agents to ask about.
   */
  settle() {
    if (this.settled || !this.teleRead || !this.began || this.running.size || this.data.busy) return false;
    return (this.settled = true);
  }

  /** Redraws shortly, once, however many jobs asked: building the rows is the costly part. */
  later(cx) {
    if (this.pending) return;
    this.pending = true;
    cx.timer.after(PUBLISH_MS, (cx) => {
      this.pending = false;
      // A held divider keeps the rows as they were; they are built again when it is let go.
      if (this.drag) return;
      const model = this.model();
      this.keepShown(model);
      if (this.digest(model) !== this.shown) cx.notify();
    });
  }

  /** Every machine has jobs of its own: one that is slow or away holds up nobody else. */
  tick(cx) {
    const { machines, folders } = this.targets();
    if (machines.length) this.began = true;
    for (const machine of machines) {
      const key = machine ?? "";
      this.job(`processes ${key}`, cx, () => this.readProcesses(machine));
      this.job(`git ${key}`, cx, async (cx) => {
        const changed = await this.readGit(machine, folders.filter((folder) => folder.machine === machine));
        // Branches are known now; pull requests are slower and get a job of their own.
        this.job(`pull requests ${key}`, cx, () => this.readPullRequests(machine));
        return changed;
      });
      if (machine) this.job(`telemetry ${key}`, cx, () => this.readRemoteTelemetry(machine));
    }
    const others = machines.filter(Boolean);
    if (others.length) this.job("reach", cx, () => this.readReach(others));
    // A copy sharing this one's storage may have stored new widths.
    const widths = JSON.stringify(this.widths);
    if (!this.drag) this.loadWidths();
    if (widths !== JSON.stringify(this.widths)) cx.notify();
    this.keepSize();
    this.dragIdle(cx);
    for (const key of this.data.procs.keys()) {
      if (machines.some((machine) => (machine ?? "") === key)) continue;
      this.data.procs.delete(key);
      this.data.readings.delete(key);
    }
    // Once a tick whatever the jobs say: another copy of the mod may have read something, and
    // time alone changes what is shown (a limit's window resets).
    this.later(cx);
  }

  async readProcesses(machine) {
    const data = this.data;
    const key = machine ?? "";
    if (Date.now() - (data.procAt.get(key) ?? 0) < (machine ? REMOTE_MS : 1000)) return false;
    data.procAt.set(key, Date.now());
    let out;
    try {
      out = await exec("ps", PS_ARGS, { on: machine, timeout: 10000 });
    } catch {
      // No ps here, or the machine is away: its CPU and memory stay empty.
      data.readings.delete(key);
      return data.procs.delete(key);
    }
    if (out.code !== 0) return false;
    const raw = parsePs(out.stdout);
    const at = Date.now();
    const span = coarseTimes(raw) ? CPU_SPAN_COARSE_MS : CPU_SPAN_MS;
    const past = data.readings.get(key) ?? [];
    const recent = past.filter((reading) => at - reading.at <= span);
    const kept = recent.length ? recent : past.slice(-1);
    const table = kept.length ? withRates(raw, kept[0].table, (at - kept[0].at) / 1000) : raw;
    data.readings.set(key, [...kept, { at, table: raw }]);
    data.procs.set(key, { table, index: childIndex(table), at });
    return true;
  }

  /**
   * The checkout each folder is in (asked once), then each checkout's branch and changes: one
   * `git status` for all the folders in it, a few checkouts at a time. Answers whether any changed.
   */
  async readGit(machine, folders) {
    const data = this.data;
    const where = machine ?? "";
    const entries = [];
    await pool(folders, GIT_AT_ONCE, async ({ cwd }) => {
      const key = `${where}\n${cwd}`;
      const now = Date.now();
      let entry = data.repos.get(key);
      if (!entry) data.repos.set(key, (entry = { repo: undefined, branch: null, status: null, repoAt: 0 }));
      entry.used = now;
      entries.push(entry);
      entry.before = `${entry.repo?.top} ${entry.repo?.common} ${entry.branch} ${statusText(entry.status)}`;
      if (entry.repo || (entry.repo === null && now - entry.repoAt <= NO_REPO_MS)) return;
      entry.repoAt = now;
      try {
        const out = await exec("git", REPO_ARGS, { cwd, on: machine, timeout: 10000 });
        entry.repo = out.code === 0 ? parseRepo(out.stdout, cwd) : null;
      } catch {
        // No git, the folder is gone, or the machine is away. Asked again later.
        entry.repo = null;
      }
    });
    const tops = [...new Set(entries.filter((entry) => entry.repo).map((entry) => entry.repo.top))];
    await pool(tops, GIT_AT_ONCE, async (top) => {
      const key = `${where}\n${top}`;
      const now = Date.now();
      let head = data.heads.get(key);
      if (!head) data.heads.set(key, (head = { branch: null, status: null, at: 0, wait: 0 }));
      head.used = now;
      if (now - head.at < head.wait) return;
      head.at = now;
      const least = machine ? REMOTE_MS * 2 : BRANCH_MS;
      try {
        const read = await this.readHead(machine, top);
        head.branch = read?.branch ?? null;
        head.status = read?.status ?? null;
        head.gone = !read;
        head.wait = Math.min(GIT_WAIT_MAX_MS, Math.max(least, (Date.now() - now) * SLOW_GIT));
      } catch {
        // The folder is gone, or the machine is away. Asked again next time: a read that
        // failed says nothing about how long a good one takes.
        head.branch = null;
        head.status = null;
        head.wait = least;
      }
    });
    let changed = false;
    for (const entry of entries) {
      const head = entry.repo ? data.heads.get(`${where}\n${entry.repo.top}`) : null;
      // Not a checkout any more: which one the folder is in is asked from the start next time.
      if (head?.gone) entry.repo = undefined;
      entry.branch = (entry.repo && head?.branch) || null;
      entry.status = (entry.repo && head?.status) || null;
      if (entry.before !== `${entry.repo?.top} ${entry.repo?.common} ${entry.branch} ${statusText(entry.status)}`) changed = true;
    }
    for (const [key, entry] of data.repos) if (Date.now() - (entry.used ?? 0) > FORGET_MS) data.repos.delete(key);
    for (const [key, head] of data.heads) if (head.gone || Date.now() - (head.used ?? 0) > FORGET_MS) data.heads.delete(key);
    return changed;
  }

  /**
   * A checkout's branch and what changed in it: { branch, status }, or null when the folder is
   * not a checkout any more. Where the status cannot be had (an old git, a checkout too large
   * to answer in time), the branch alone.
   */
  async readHead(machine, top) {
    const where = machine ?? "";
    const git = (args) => exec("git", args, { cwd: top, on: machine, timeout: 10000 });
    if ((this.data.plainGit.get(where) ?? 0) <= Date.now()) {
      try {
        const out = await git(STATUS_ARGS);
        const status = out.code === 0 ? parseStatus(out.stdout) : null;
        if (status) return { branch: status.branch, status };
        // 129: this git does not know the options (it is older than 2.15). Any other failure is
        // this checkout's own (a broken index): its branch alone, and the others are not touched.
        if (out.code === 129) this.data.plainGit.set(where, Date.now() + PLAIN_GIT_MS);
      } catch {
        // No answer in time (a very large checkout), or the machine is away: the branch, which
        // is quick to ask, tells which.
      }
    }
    const head = await git(["symbolic-ref", "--short", "-q", "HEAD"]);
    if (head.code === 0) return { branch: head.stdout.trim() || null, status: null };
    if (head.code !== 1) return null;
    // No branch: a commit is checked out.
    const commit = await git(["rev-parse", "--short", "HEAD"]);
    return { branch: commit.code === 0 && commit.stdout.trim() ? `@${commit.stdout.trim()}` : null, status: null };
  }

  /**
   * How ssh reaches the other machines, for opening their folders in VS Code: one listing for
   * all of them. Answers whether any changed.
   */
  async readReach(machines) {
    const data = this.data;
    const now = Date.now();
    if (machines.every((machine) => now - (data.reach.get(machine)?.at ?? -Infinity) < REACH_MS)) return false;
    let listing = null;
    try {
      const out = await hc(["machine", "ls", "--json"]);
      if (out.code === 0) listing = out.stdout;
    } catch {
      // hc did not answer: what was known stays, and it is asked again soon.
    }
    let changed = false;
    for (const machine of machines) {
      const held = data.reach.get(machine)?.target ?? null;
      const target = listing == null ? held : sshTarget(listing, machine);
      if (target !== held) changed = true;
      data.reach.set(machine, { target, at: listing == null ? now - REACH_MS + REMOTE_MS * 2 : now });
    }
    return changed;
  }

  /** Whether gh can be run on a machine at all: "here", "missing", or "away" (it cannot be told). */
  async findGh(machine) {
    try {
      await exec("gh", ["--version"], { on: machine, timeout: 10000 });
      return "here";
    } catch (error) {
      return /cannot run gh\b|not found|no such file/i.test(String(error)) ? "missing" : "away";
    }
  }

  /** The pull request of each branch an agent is on. Answers whether any changed. */
  async readPullRequests(machine) {
    const data = this.data;
    const where = machine ?? "";
    const started = Date.now();
    let changed = false;
    const wanted = new Map();
    for (const [key, entry] of data.repos) {
      const cut = key.indexOf("\n");
      if (key.slice(0, cut) !== where) continue;
      if (!entry.repo || !entry.branch || entry.branch.startsWith("@") || Date.now() - (entry.used ?? 0) > BRANCH_MS * 6) continue;
      wanted.set(`${where}\n${entry.repo.common}\n${entry.branch}`, { cwd: key.slice(cut + 1), branch: entry.branch });
    }
    for (const [key, { cwd, branch }] of wanted) {
      const now = Date.now();
      if (now - started > PR_RUN_MS || (data.ghOff.get(where) ?? 0) > now) break;
      let held = data.prs.get(key);
      if (held && (now - held.at < (held.pr ? PR_FOUND_MS : PR_NONE_MS) || now - (held.asked ?? 0) < PR_ASKING_MS)) continue;
      // Said before asking, so another copy of the mod does not ask the same at the same time.
      if (!held) data.prs.set(key, (held = { pr: null, at: 0 }));
      held.asked = now;
      try {
        const out = await exec("gh", prArgs(branch), { cwd, on: machine, timeout: 20000 });
        // A failure (offline, not signed in, not on GitHub) keeps what was known.
        if (out.code === 0) {
          const pr = pickPr(out.stdout);
          if (JSON.stringify(pr) !== JSON.stringify(held.pr)) changed = true;
          held.pr = pr;
        }
        held.at = Date.now();
      } catch {
        // gh is not here at all, cannot be reached, or this one call went wrong (the folder is
        // gone, no answer in time). Only the first two stop the round.
        const gh = await this.findGh(machine);
        if (gh !== "here") {
          data.ghOff.set(where, Date.now() + (gh === "missing" ? GH_RETRY_MS : GH_AWAY_MS));
          break;
        }
        held.at = Date.now();
      }
    }
    for (const [key, held] of data.prs) {
      if (key.startsWith(`${where}\n`) && !wanted.has(key) && Date.now() - Math.max(held.at, held.asked ?? 0) > FORGET_MS) data.prs.delete(key);
    }
    return changed;
  }

  /** The telemetry folder on a machine: its own environment decides. */
  async findTelemetryDir(machine) {
    const given = props()?.telemetryDir;
    if (given && !machine) return given;
    try {
      const out = await exec("sh", ["-c", DIR_SCRIPT], { on: machine, timeout: 10000 });
      if (out.code === 0 && out.stdout.trim()) return out.stdout.trim();
    } catch {
      // No sh (Windows): the default place under the home folder.
    }
    return machine ? null : telemetryDir({}, home());
  }

  /** The names in the folder; [] when it is not there, null when it could not be asked. */
  async listTelemetry(machine, dir) {
    if (!machine) {
      try {
        return await fs.readdir(dir);
      } catch {
        // Outside the folders a mod may list itself, or not there: ask ls.
      }
    }
    try {
      const out = await exec("ls", ["-1", dir], { on: machine, timeout: 10000 });
      return out.code === 0 ? out.stdout.split("\n") : [];
    } catch {
      return null;
    }
  }

  /** Reads every file in the folder. */
  async readTelemetry(machine, dir) {
    const names = await this.listTelemetry(machine, dir);
    // Could not ask (the machine is away): what was read before stays.
    if (!names) return;
    const files = new Map();
    await Promise.all(names.filter(isTelemetryFile).map((name) => this.readFile(machine, dir, name, files)));
    if (!machine) this.tele.files = files;
    this.tele.records.set(machine ?? "", [...files.values()]);
  }

  async readFile(machine, dir, name, files) {
    let text = null;
    try {
      text = await readTextFile(`${dir}/${name}`, { on: machine });
    } catch {
      // Removed between the listing and the read.
    }
    const record = text ? parseTelemetry(text) : null;
    if (record) files.set(name, record);
    else files.delete(name);
  }

  /** Reads the files of this machine's folder that a watch reported: one session's write is one read. */
  async readChanged(dir, paths) {
    const names = new Set();
    for (const path of paths ?? []) {
      const name = String(path).split(/[\\/]/).pop();
      if (isTelemetryFile(name)) names.add(name);
      // A writer's temporary file says nothing. Anything else (the folder itself: too much
      // changed to list) means read it all.
      else if (!name.startsWith(".")) return this.readTelemetry(null, dir);
    }
    await Promise.all([...names].map((name) => this.readFile(null, dir, name, this.tele.files)));
    this.tele.records.set("", [...this.tele.files.values()]);
  }

  async readRemoteTelemetry(machine) {
    if (Date.now() - (this.teleAt.get(machine) ?? 0) < REMOTE_MS * 2) return false;
    this.teleAt.set(machine, Date.now());
    if (!this.data.homes.has(machine)) {
      try {
        const out = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine, timeout: 10000 });
        if (out.code === 0 && out.stdout.trim()) this.data.homes.set(machine, out.stdout.trim());
      } catch {
        // Asked again next time; until then its folders are shown in full.
      }
    }
    if (!this.teleDir.get(machine)) this.teleDir.set(machine, await this.findTelemetryDir(machine));
    const dir = this.teleDir.get(machine);
    if (dir) await this.readTelemetry(machine, dir);
  }

  /** This machine's folder is watched, not polled; while it is missing, looked for now and then. */
  watchTelemetry(cx) {
    cx.spawn(async (cx) => {
      const dir = await this.findTelemetryDir(null);
      let changed = null;
      for (;;) {
        const read = changed ? this.readChanged(dir, changed) : this.readTelemetry(null, dir);
        await read.catch((error) => console.warn(`herdr-agents: telemetry: ${error}`));
        this.teleRead = true;
        this.settle();
        // A session that has just started is not in the last process reading yet, and a file
        // whose process is not running is skipped: read the processes again, once for each
        // new pid (a file left by a crashed session keeps its dead pid for good).
        const pids = (this.tele.records.get("") ?? []).map((record) => record.pid).filter((pid) => pid != null);
        const table = this.data.procs.get("")?.table;
        const fresh = pids.filter((pid) => !this.asked.has(pid) && table && !table.has(pid));
        this.asked = new Set(pids.filter((pid) => this.asked.has(pid) || fresh.includes(pid)));
        if (fresh.length) {
          this.data.procAt.delete("");
          this.job("processes ", cx, () => this.readProcesses(null));
        }
        this.later(cx);
        try {
          changed = await watchFolder(dir);
          // A writer renames a temporary file over the old one: let the pair settle.
          await cx.sleep(250);
        } catch {
          // The folder is not there (no telemetry installed, or not yet): look again later.
          changed = null;
          await cx.sleep(MISSING_DIR_MS);
        }
      }
    });
  }

  // ---- what is shown ----

  /** Rows with everything known about them, in display order. */
  model() {
    const demo = this.demo;
    const source = demo ?? { terminals: terminals(), agents: agents(), spaces: spaces() };
    const tree = buildTree(source.terminals, source.agents, source.spaces, this.folded);
    // agent.next and agent.prev go by the whole tree: folding a row here must not reorder them.
    const order = (this.folded.size ? buildTree(source.terminals, source.agents, source.spaces) : tree).rows.map((row) => row.address);
    const houseOf = (key) => demo?.home ?? (key ? this.data.homes.get(key) ?? null : home());
    const spaceName = new Map((source.spaces ?? []).map((space) => [space.id, space.name]));
    // Which agents have a pane to go to; the rest (helpers started in the background) are peeked at.
    const paned = demo ? null : panedTerminals(panes(), source.agents);

    const telemetry = new Map();
    const perMachine = new Map();
    for (const row of tree.rows) {
      const key = row.machine ?? "";
      if (!perMachine.has(key)) perMachine.set(key, []);
      perMachine.get(key).push({ address: row.address, id: row.id, pids: rootPids(row.terminal), created: row.terminal.created_ms ?? null });
    }
    for (const [key, list] of perMachine) {
      const table = this.data.procs.get(key)?.table ?? null;
      // Another machine without a process reading is away, or not read yet: its files cannot
      // be told live from left behind, so they wait. (Here, no reading means no ps at all.)
      if (key && !table) continue;
      for (const [address, record] of matchTelemetry(list, this.tele.records.get(key), table)) telemetry.set(address, record);
    }

    const groups = tree.groups.map((group) => ({
      ...group,
      rows: group.rows.map((row) => {
        const key = row.machine ?? "";
        const terminal = row.terminal;
        const procs = this.data.procs.get(key);
        const pids = rootPids(terminal);
        const usage = procs ? treeUsage(procs.table, pids[0], procs.index) ?? treeUsage(procs.table, pids[1], procs.index) : null;
        const cwd = cwdOf(terminal);
        const house = houseOf(key);
        const checkout = this.data.repos.get(`${key}\n${cwd}`);
        const repo = checkout?.repo ?? null;
        const branch = checkout?.branch ?? null;
        const git = checkout?.status ?? null;
        // What a click on the folder opens in VS Code: here, or over ssh where ssh reaches the machine.
        const host = key ? this.data.reach.get(key)?.target ?? null : null;
        const open = cwd && (!key || host) ? { path: cwd, host } : null;
        const pr = repo && branch ? this.data.prs.get(`${key}\n${repo.common}\n${branch}`)?.pr ?? null : null;
        const title = plain(terminal.title);
        const name = terminal.name || title || terminal.program?.name || row.address;
        const tab = row.tab ? (/^\d+$/.test(String(row.tab.name ?? "")) ? `tab ${row.tab.name}` : row.tab.name) : "";
        const elsewhere = row.space && group.space && row.space !== group.space ? spaceName.get(row.space) : null;
        return {
          ...row,
          name,
          title: terminal.name && title && title !== terminal.name ? title : "",
          where: [elsewhere, tab].filter(Boolean).join(" · "),
          cwd,
          folder: folderLabel(cwd, repo, house),
          branch,
          git,
          open,
          pr,
          usage,
          tele: telemetry.get(row.address) ?? null,
          go: paned ? goCommand(row.address, paned) : null,
          tip: [`${terminal.program?.name ?? "agent"} · ${row.address}${paned && !paned.has(row.address) ? " · no pane: a click peeks at it" : ""}`, cwd ? tilde(cwd, house) : null, [branch, prNote(pr)].filter(Boolean).join(" · "), statusNote(git), terminal.report?.msg].filter(Boolean).join("\n"),
        };
      }),
    }));
    return { groups, rows: groups.flatMap((group) => group.rows), order };
  }

  /** Everything a redraw would show differently, as one string. */
  digest(model) {
    return this.shownColumns(model).join(",") + "\n" + model.rows.map((row) => [row.address, row.depth, row.name, row.title, ...COLUMNS.map((column) => cellText(row, column.key)), row.pr?.state ?? "", row.open?.host ?? (row.open ? "here" : ""), row.go?.name ?? "", row.hidden.join(",")].join("\t")).join("\n");
  }

  /** Opened over the window, the mod goes away once it has taken the person somewhere. */
  leave() {
    const given = props() ?? {};
    if (given.overlay && !given.stay) closeOverlay(given.overlay);
  }

  activate(row, cx) {
    this.cursor = row.address;
    if (row.go) {
      run(row.go.name, row.go.args);
      this.leave();
    }
    cx.notify();
  }

  /** Opens the row's folder in VS Code, and does nothing else: the mod stays as it is. */
  openDir(row, cx) {
    if (this.demo || !row.open) return;
    const { path, host } = row.open;
    cx.spawn(async () => {
      try {
        const out = await exec("code", codeArgs(path, host), { timeout: 20000 });
        if (out.code !== 0) throw new Error(out.stderr.trim() || `code ended with ${out.code}`);
      } catch (error) {
        const missing = /cannot run code\b|not found|no such file/i.test(String(error));
        notify({
          title: "Could not open VS Code",
          body: missing ? "The code command is not on the PATH. In VS Code, run “Shell Command: Install 'code' command in PATH”." : String(error?.message ?? error),
          level: "warning",
        });
      }
    });
  }

  /** Puts the cursor on the agent the person is in, whenever that changes: keys move from there. */
  follow(model) {
    const here = model.rows.find((row) => row.listed?.focused)?.address ?? (this.demo ? null : focused()?.agent) ?? null;
    if (here === this.here) return;
    this.here = here;
    if (!here || !model.rows.some((row) => row.address === here)) return;
    this.cursor = here;
    this.reveal = here;
  }

  /** Whether the columns of the last time still stand in for readings that are not in yet. */
  holding() {
    return !this.settled && Date.now() - this.opened < HOLD_MS;
  }

  /**
   * The columns to show, by key. Just opened, the ones shown the last time stay although the
   * readings that fill them are not in yet: nothing comes in a moment later and moves the rest.
   */
  shownColumns(model) {
    // Which columns have something in them is worked out once for each set of rows.
    model.filled ??= COLUMNS.filter((column) => model.rows.some((row) => cellText(row, column.key))).map((column) => column.key);
    return shownKeys(model.filled, this.remembered, this.holding());
  }

  /** Remembers the columns shown, once the readings are in, for the first frame of the next time. */
  keepShown(model) {
    if (this.demo || this.holding() || !model.rows.length) return;
    const text = JSON.stringify(this.shownColumns(model));
    if (text === this.shownKept) return;
    this.shownKept = text;
    this.keep("shown", text);
  }

  // The divider on a column's right edge is dragged: the table holds to the left edge, so the
  // divider stays under the pointer and the columns right of it move along.

  dragStart(column, event, cx) {
    cx.stop_propagation();
    this.drag = null;
    // Pressed twice: as wide as what is in it. The column is laid out once at its natural
    // width where nobody sees it, and `fitted` hears how wide that came out.
    if (event.click_count >= 2) this.fit = { key: column.key, turn: ++this.turn };
    else this.drag = { key: column.key, min: column.min, x: event.position.x, width: column.width, now: column.width, at: Date.now() };
    cx.notify();
  }

  dragTo(event, cx) {
    const drag = this.drag;
    if (!drag) return;
    // A move after a long stillness: the button went up where the mod could not hear it, and
    // the pointer has come back. The column stays as it was left.
    if (this.dragIdle(cx)) return;
    drag.at = Date.now();
    const width = dragged(drag.width, event.position.x - drag.x, drag.min);
    if (width === drag.now) return;
    drag.now = width;
    cx.notify();
  }

  dragEnd(cx) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.now !== drag.width) this.storeWidth(drag.key, drag.now);
    cx.notify();
  }

  /** Ends a drag that has not moved for a while; says whether it did. */
  dragIdle(cx) {
    if (!this.drag || Date.now() - this.drag.at < DRAG_IDLE_MS) return false;
    this.dragEnd(cx);
    return true;
  }

  fitted(fit, width, cx) {
    if (this.fit !== fit) return;
    this.fit = null;
    const column = fit.key === NAME.key ? NAME : COLUMNS.find((one) => one.key === fit.key);
    // Two px to spare: a width cut to the text's own would end in an ellipsis at some zoom.
    if (column && width > 0) this.storeWidth(column.key, clampWidth(Math.ceil(width) + 2, column.min));
    cx.notify();
  }

  /** The copy goes while a divider is held (Esc over the window): what was dragged so far is kept. */
  close() {
    const drag = this.drag;
    this.drag = null;
    if (drag && drag.now !== drag.width) this.storeWidth(drag.key, drag.now);
    this.keepSize();
  }

  /** A value kept in this copy's storage, read through `parse`; null when there is none. */
  stored(key, parse) {
    try {
      const text = localStorage.getItem(key);
      return text == null ? null : parse(text);
    } catch {
      return null;
    }
  }

  keep(key, text) {
    try {
      localStorage.setItem(key, text);
    } catch {
      // No storage here: it lasts as long as this copy.
    }
  }

  /** Remembers how big this copy is, for the first frame of the next time. */
  keepSize() {
    if (!this.laid) return;
    const text = JSON.stringify(this.size);
    if (text === this.sizeKept) return;
    this.sizeKept = text;
    this.keep("size", text);
  }

  loadWidths() {
    try {
      this.widths = parseWidths(localStorage.getItem("widths"));
    } catch {
      // No storage here: the columns keep their own widths, or what was dragged in this copy.
    }
  }

  /** Keeps one column's width. Read first: a copy sharing the storage may have stored others. */
  storeWidth(key, width) {
    this.loadWidths();
    this.widths = { ...this.widths, [key]: width };
    this.keep("widths", JSON.stringify(this.widths));
  }

  toggle(address, cx) {
    if (this.folded.has(address)) this.folded.delete(address);
    else this.folded.add(address);
    cx.notify();
  }

  key(event, cx) {
    const rows = this.lines.filter((line) => line.row);
    if (!rows.length) return;
    const at = rows.findIndex((line) => line.row.address === this.cursor);
    const go = (index) => {
      const line = rows[Math.max(0, Math.min(rows.length - 1, index))];
      this.cursor = line.row.address;
      this.scroll.scroll_to_item(this.lines.indexOf(line));
    };
    const row = rows[at]?.row;
    switch (event.keystroke) {
      case "down": case "j": go(at + 1); break;
      case "up": case "k": go(at < 0 ? rows.length - 1 : at - 1); break;
      case "home": go(0); break;
      case "end": go(rows.length - 1); break;
      case "enter": if (row) this.activate(row, cx); break;
      case "left": if (row?.kids && !row.folded) this.toggle(row.address, cx); break;
      case "right": if (row?.folded) this.toggle(row.address, cx); break;
      default: return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  dot(t, status) {
    const color = t[status] ?? t.unknown ?? t.dim;
    const mark = div().size(8).flex_none().rounded(4);
    if (status === "idle" || status === "unknown") return mark.border(1.5).border_color(color);
    if (status === "working") return mark.bg(color).loop("opacity", { from: 0.3, to: 1, period: 1400 });
    return mark.bg(color);
  }

  cellColor(t, row, key) {
    // Green to red, from the theme's own three.
    const scale = [t.ansi2, t.ansi3, t.ansi1];
    switch (key) {
      case "status": return t[row.status] ?? t.dim;
      case "context": return heat(scale, percentLevel(row.tele?.context?.percent)) ?? t.muted;
      case "five": return heat(scale, percentLevel(limitPercent(row.tele, "five_hour"))) ?? t.muted;
      case "seven": return heat(scale, percentLevel(limitPercent(row.tele, "seven_day"))) ?? t.muted;
      case "model": return heat(scale, modelLevel(row.tele?.model)) ?? t.muted;
      case "effort": return heat(scale, effortLevel(row.tele?.effort)) ?? t.muted;
      case "pr": return row.pr?.state === "open" ? t.accent : row.pr?.state === "draft" ? t.muted : t.dim;
      case "branch": return t.muted;
      case "cpu": return (row.usage?.cpu ?? 0) >= 50 ? t.foreground : t.muted;
      default: return t.dim;
    }
  }

  /** One level of the tree in front of a row: lines drawn the full height, so rows join up. */
  guide(t, kind) {
    const line = t.input ?? t.border;
    const box = div().relative().w(16).flex_none().self_stretch();
    if (kind === "space") return box;
    return box
      .child(div().absolute().left(7).top(0).w(1).h(kind === "elbow" ? "50%" : "100%").bg(line))
      .when(kind !== "pipe", (el) => el.child(div().absolute().left(7).top("50%").w(8).h(1).bg(line)));
  }

  /** The tree lines and the program's icon: the start of every row. */
  lead(t, row) {
    const icon = row.terminal.program?.icon;
    return [
      row.depth ? h_flex().flex_none().self_stretch().children(row.guides.map((kind) => this.guide(t, kind))) : null,
      icon ? (row.terminal.program.tint ? svg(icon).size(14).flex_none().text_color(t.muted) : image(icon).w(14).h(14).flex_none()) : null,
    ].filter(Boolean);
  }

  /**
   * Folds a parent's children away; folded, it says how many are hidden and how urgent they are.
   * `natural`: only its look, for measuring.
   */
  fold(t, row, natural = false) {
    const top = row.hidden.reduce((most, status) => (URGENCY[status] > URGENCY[most] ? status : most), "unknown");
    const color = row.folded ? (URGENCY[top] > URGENCY.idle ? t[top] : t.muted) : t.dim;
    const mark = row.folded ? `▸ ${row.hidden.length}` : "▾";
    if (natural) return div().flex_none().px(4).text_size(10.5).child(mark);
    return div().id(`fold-${row.address}`).flex_none().px(4).rounded(4).text_size(10.5).text_color(color).cursor_pointer()
      .hover((el) => el.bg(t.raised).text_color(t.foreground))
      .tooltip(row.folded ? "Show its agents" : "Hide its agents")
      .on_click((_event, cx) => { cx.stop_propagation(); this.toggle(row.address, cx); })
      .child(mark);
  }

  /**
   * The start of a row: tree lines, icon, name, fold control, title. `width` null: as wide as
   * what is in it and nothing to press, for measuring.
   */
  nameCell(t, row, width) {
    const natural = width == null;
    const box = natural ? h_flex().flex_none() : h_flex().id(`name-${row.address}`).w(width).flex_none().min_w(0).tooltip(row.tip);
    const cut = (el) => (natural ? el.flex_none() : el.min_w(0).truncate());
    return box.self_stretch().gap(6).items_center()
      .children(this.lead(t, row))
      .child(cut(div()).text_color(row.status === "idle" ? t.muted : t.foreground).child(row.name))
      .when(row.kids, (el) => el.child(this.fold(t, row, natural)))
      .when(row.title, (el) => el.child((natural ? div().flex_none() : div().flex_1().min_w(0).truncate()).text_color(t.dim).child(row.title)));
  }

  /** One cell. `natural`: as wide as what is in it and nothing to press, for measuring. */
  cell(t, row, column, natural = false) {
    const text = cellText(row, column.key);
    const id = `${column.key}-${row.address}`;
    const framed = (el) => (natural ? el.flex_none() : el.id(id).w(column.width).flex_none());
    const cut = (el) => (natural ? el.flex_none() : el.min_w(0).truncate());
    if (column.key === "status") {
      return framed(h_flex()).gap(7).items_center().child(this.dot(t, row.status)).child(cut(div()).text_color(this.cellColor(t, row, "status")).child(text));
    }
    if (column.key === "pr" && text) {
      // The merged mark stands outside the number, so a long number cannot cut it off.
      const box = framed(h_flex()).gap(4).text_color(this.cellColor(t, row, "pr"))
        .child(cut(div()).child(text))
        .when(row.pr.state === "merged", (el) => el.child(div().flex_none().child("✓")));
      if (natural) return box;
      const tipped = box.tooltip([prNote(row.pr), row.pr.title].filter(Boolean).join("\n"));
      if (!row.pr.url) return tipped;
      return tipped.cursor_pointer().hover((el) => el.text_color(t.foreground))
        .on_click((_event, cx) => { cx.stop_propagation(); cx.open_url(row.pr.url); });
    }
    if (column.key === "model" && text) {
      // The model and the effort each have a color of their own.
      const model = shortModel(row.tele.model);
      const effort = row.tele.effort;
      return framed(h_flex())
        .when(!natural, (el) => el.overflow_hidden().tooltip(text))
        .when(model, (el) => el.child(cut(div()).text_color(this.cellColor(t, row, "model")).child(model)))
        .when(model && effort, (el) => el.child(div().flex_none().text_color(t.dim).child("/")))
        .when(effort, (el) => el.child(div().flex_none().text_color(this.cellColor(t, row, "effort")).child(effort)));
    }
    if (column.key === "git" && text) {
      // Marks that do not fit give way to an ellipsis: a number cut short would read as another.
      const parts = natural ? statusParts(row.git) : fitParts(statusParts(row.git), column.width);
      return framed(h_flex()).gap(5)
        .when(!natural, (el) => el.overflow_hidden().tooltip(statusNote(row.git)))
        .children(parts.map((part) => div().flex_none().text_color(t[GIT_COLOR[part.kind]] ?? t.dim).child(part.text)));
    }
    const box = framed(div()).text_color(this.cellColor(t, row, column.key));
    if (natural) return box.child(text);
    if (column.key === "dir" && text && row.open) {
      // A link: the folder opens in VS Code.
      return box.truncate().cursor_pointer().hover((el) => el.underline().text_color(t.foreground))
        .tooltip(`Open ${row.open.host ? `${row.open.host}:` : ""}${row.open.path} in VS Code`)
        .on_click((_event, cx) => { cx.stop_propagation(); this.openDir(row, cx); })
        .child(text);
    }
    return box.truncate().when(column.right, (el) => el.text_right()).when(text.length > 12, (el) => el.tooltip(text)).child(text);
  }

  /** The headings. In the gap after each one is the divider on its right edge, to drag. */
  headings(t, name, columns) {
    const heading = (column) =>
      div().relative().w(column.width).flex_none()
        .child(div().truncate().when(column.right, (el) => el.text_right()).child(column.label))
        .child(div().id(`divider-${column.key}`).absolute().right(-GAP / 2 - 4).top(-2).bottom(-2).w(9).rounded(2).cursor_col_resize()
          .hover((el) => el.bg(t.hover))
          .tooltip("Drag to resize, double-click to fit")
          .on_mouse_down("left", (event, cx) => this.dragStart(column, event, cx))
          .child(div().absolute().left(4).top(3).bottom(3).w(1).bg(this.drag?.key === column.key ? t.accent : t.border)));
    return h_flex().h(HEAD).flex_none().mx(6).px(8).gap(GAP).items_center().text_size(10.5).text_color(t.dim)
      .children([name, ...columns].map(heading));
  }

  /**
   * One column laid out as wide as what is in it, heading included, where nobody sees it:
   * `on_size_change` then says how wide that is. A new id each time, so it is a first layout.
   */
  measure(t, model, fit) {
    const column = fit.key === NAME.key ? NAME : COLUMNS.find((one) => one.key === fit.key);
    return v_flex().id(`herdr-agents-fit-${fit.key}-${fit.turn}`).absolute().left(0).top(0).opacity(0).items_start().whitespace_nowrap().text_size(12.5)
      .on_size_change((size, cx) => this.fitted(fit, size.width, cx))
      .child(div().flex_none().text_size(10.5).child(column.label))
      .children(model.rows.map((row) => (column === NAME ? this.nameCell(t, row, null) : this.cell(t, row, column, true))));
  }

  rowBase(t, row) {
    const here = row.address === this.here;
    return h_flex().id(`row-${row.address}`).flex_none().mx(6).px(8).rounded(6).items_center().cursor_pointer()
      .when(here, (el) => el.bg(t.selected))
      .when(row.address === this.cursor && !here, (el) => el.bg(t.hover))
      .hover((el) => el.bg(t.hover))
      .on_click((_event, cx) => this.activate(row, cx));
  }

  tableRow(t, row, name, columns) {
    return this.rowBase(t, row).h(26).gap(GAP)
      .child(this.nameCell(t, row, name.width))
      .children(columns.map((column) => this.cell(t, row, column)));
  }

  compactRow(t, row) {
    const dir = cellText(row, "dir");
    const about = [
      // A clean checkout says nothing here: its mark would read as the merged one's.
      [row.branch, statusParts(row.git).some((part) => part.kind !== "clean") ? cellText(row, "git") : "", cellText(row, "pr"), row.pr?.state === "merged" ? "✓" : ""].filter(Boolean).join(" "),
      cellText(row, "model"),
      [cellText(row, "cpu"), cellText(row, "mem")].filter(Boolean).join(" "),
    ].filter(Boolean).join(" · ");
    const context = cellText(row, "context");
    return this.rowBase(t, row).gap(6).tooltip(row.tip)
      .children(this.lead(t, row).slice(0, row.depth ? 1 : 0))
      .child(v_flex().flex_1().min_w(0).py(4).gap(1)
        .child(h_flex().gap(6).items_center()
          .children(this.lead(t, row).slice(row.depth ? 1 : 0))
          .child(div().min_w(0).truncate().text_color(row.status === "idle" ? t.muted : t.foreground).child(row.name))
          .when(row.kids, (el) => el.child(this.fold(t, row))))
        .when(dir || about, (el) => el.child(h_flex().min_w(0).gap(3).text_size(11).text_color(t.dim)
          .when(dir && row.open, (line) => line.child(div().id(`dir-${row.address}`).min_w(0).truncate().cursor_pointer()
            .hover((link) => link.underline().text_color(t.foreground))
            .on_click((_event, cx) => { cx.stop_propagation(); this.openDir(row, cx); })
            .child(dir)))
          .when(dir && !row.open, (line) => line.child(div().min_w(0).truncate().child(dir)))
          .when(about, (line) => line.child(div().flex_1().min_w(0).truncate().child(dir ? `· ${about}` : about))))))
      .when(context, (el) => el.child(div().flex_none().text_size(11.5).text_color(this.cellColor(t, row, "context")).child(context)))
      .child(this.dot(t, row.status));
  }

  railRow(t, row) {
    return h_flex().id(`row-${row.address}`).h(24).flex_none().items_center().justify_center().cursor_pointer().tooltip(row.name)
      .hover((el) => el.bg(t.hover))
      .on_click((_event, cx) => this.activate(row, cx))
      .child(this.dot(t, row.status));
  }

  groupRow(t, group) {
    return h_flex().id(`group-${group.id}`).h(24).flex_none().mx(6).px(8).mt(6).gap(8).items_center().text_size(11).font_medium().text_color(t.dim)
      .child(div().min_w(0).truncate().child(group.name || "agents"))
      .when(group.machine, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_color(t.muted).child(group.machine)));
  }

  topBar(t, model, mode, width) {
    const count = {};
    // Agents folded away count too: one of them may need the person.
    for (const status of model.rows.flatMap((row) => [row.status, ...row.hidden])) count[status] = (count[status] ?? 0) + 1;
    const cpu = model.rows.reduce((sum, row) => sum + (row.usage?.cpu ?? 0), 0);
    const rss = model.rows.reduce((sum, row) => sum + (row.usage?.rss ?? 0), 0);
    const cost = model.rows.reduce((sum, row) => sum + (row.tele?.cost ?? 0), 0);
    const totals = [rss ? `CPU ${cpuText(cpu)}` : "", rss ? memText(rss) : "", cost ? costText(cost) : ""].filter(Boolean).join("  ·  ");
    // What the bar has room for: the counts first, the most urgent longest, then the word.
    const gap = 12;
    const room = width - 28;
    const counts = COUNTED.filter((status) => count[status]).map((status) => ({ key: status, width: countWidth(count[status]), rank: -URGENCY[status] }));
    const kept = fitColumns(counts, room, gap);
    const used = kept.reduce((sum, status) => sum + countWidth(count[status]) + gap, 0);
    return h_flex().h(36).flex_none().px(14).gap(gap).items_center().overflow_hidden().text_size(11.5)
      .when(used + WORD_WIDTH <= room, (el) => el.child(div().flex_none().font_medium().text_color(t.muted).child("Agents")))
      .children(kept.map((status) =>
        h_flex().flex_none().gap(5).items_center().child(this.dot(t, status)).child(div().text_color(t.dim).child(String(count[status])))))
      .child(div().flex_1())
      .when(mode === "table" && totals, (el) => el.child(div().flex_none().text_color(t.dim).child(totals)));
  }

  render() {
    const t = theme();
    const given = props() ?? {};
    // While a border is held every move of the pointer draws again: the rows are not built anew.
    const drag = this.drag;
    const model = drag && this.last ? this.last : this.model();
    this.last = model;
    if (!drag) {
      this.keepShown(model);
      this.shown = this.digest(model);
      this.follow(model);
    }
    // A copy in the layout decides the order of agent.next / agent.prev; one opened over the
    // window for a moment leaves it to the list that stays.
    if (!this.demo && (given.order ?? !given.overlay)) setAgentOrder(model.order);

    const root = v_flex().id("herdr-agents").size_full().min_h(0).bg(t[given.background] ?? (given.overlay ? t.popover : t.chrome)).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .on_mouse_move((event, cx) => this.dragTo(event, cx))
      .on_mouse_up("left", (_event, cx) => this.dragEnd(cx))
      .on_size_change((size, cx) => {
        const first = !this.laid;
        this.laid = true;
        this.size = size;
        // Opened over the window (mod.open): the keyboard is here from the start.
        if (first && props()?.overlay) this.handle.focus();
        cx.notify();
      });
    // How big it is is not known yet, and was not kept from the last time: nothing is drawn
    // that would have to move a frame later.
    if (!this.size) return root;

    const width = this.size.width;
    const mode = width < 110 ? "rail" : width < 520 ? "compact" : "table";
    // The table holds to the left edge: the name, then the columns, each as wide as it was made.
    const live = (column) => (drag?.key === column.key ? { ...column, width: drag.now } : column);
    // While a divider is held the columns stay: one going would take the divider from under the pointer.
    if (!drag || !this.keys) this.keys = this.shownColumns(model);
    const shown = new Set(this.keys);
    const name = live(sized([NAME], this.widths)[0]);
    const columns = sized(COLUMNS.filter((column) => shown.has(column.key)), this.widths).map(live);
    // Wider than the block, the table scrolls sideways; narrower, the rest stays empty. While a
    // divider is held the table does not get narrower: scrolled sideways, it would slide under
    // the pointer as the room to scroll shrinks.
    const across = Math.max(width, EDGE + tableWidth(name.width, columns, GAP), drag ? this.across : 0);
    this.across = across;
    if (mode !== "table" || !model.rows.length) this.fit = null;

    const lines = [];
    for (const group of model.groups) {
      if (mode !== "rail") lines.push({ group });
      for (const row of group.rows) lines.push({ row });
    }
    this.lines = lines;
    if (this.reveal) {
      const index = lines.findIndex((line) => line.row?.address === this.reveal);
      if (index >= 0) this.scroll.scroll_to_item(index);
      this.reveal = null;
    }
    const draw = (line) => {
      if (line.group) return this.groupRow(t, line.group);
      if (mode === "rail") return this.railRow(t, line.row);
      return mode === "compact" ? this.compactRow(t, line.row) : this.tableRow(t, line.row, name, columns);
    };
    const none = model.rows.length === 0;
    const table = mode === "table" && !none;
    // In the table the rows' scrollbar is drawn apart, at the block's right edge: their own
    // would stand at the table's, out of sight when the table is wider than the block.
    const rows = v_flex().id("herdr-agents-rows").flex_1().min_h(0).pb(8).track_scroll(this.scroll).children(lines.map(draw));

    return root
      .when(mode !== "rail", (el) => el.child(this.topBar(t, model, mode, width)))
      .when(none && mode !== "rail", (el) => el.child(div().px(14).py(6).text_color(t.dim).child("No agents are running.")))
      .when(!table, (el) => el.child(rows.overflow_y_scrollbar()))
      .when(table, (el) => el.child(
        div().relative().flex().flex_1().min_h(0)
          .child(div().id("herdr-agents-table").flex().size_full().overflow_x_scrollbar()
            .child(v_flex().flex_none().w(across).child(this.headings(t, name, columns)).child(rows.overflow_y_scroll())))
          .child(div().absolute().top(HEAD).right(0).bottom(0).w(12).child(Scrollbar.vertical("herdr-agents-rows").absolute().inset_0()))))
      .when(this.fit && table, (el) => el.child(this.measure(t, model, this.fit)))
      // While a divider is held, a sheet over everything hears the pointer's moves and its
      // release wherever it is over the mod. A release outside the mod is not heard, and a move
      // does not say whether the button is down: so the drag ends where the pointer leaves the
      // mod (the sheet's `on_hover`), and a press ends it too.
      .when(drag, (el) => el.child(div().id("herdr-agents-drag").absolute().inset_0().cursor_col_resize()
        .on_mouse_move((event, cx) => this.dragTo(event, cx))
        .on_mouse_up("left", (_event, cx) => this.dragEnd(cx))
        .on_hover((over, cx) => { if (!over) this.dragEnd(cx); })
        .on_mouse_down("left", (_event, cx) => { cx.stop_propagation(); this.dragEnd(cx); })));
  }
}
