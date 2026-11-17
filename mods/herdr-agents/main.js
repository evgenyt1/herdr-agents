// herdr-agents: every agent terminal as a row. Status, the parent tree, where it is, its git
// branch, changes and pull request, CPU and memory; and when agent-telemetry files are present,
// the model, effort, context, limits and cost they report. Nothing here needs telemetry to work.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, spaces, focused, theme, props, run, exec, hc, home, notify, readTextFile, watchFolder, nextCommand, setAgentOrder, closeOverlay } from "herdr";
import * as fs from "fs/promises";
import { buildTree, isAgent, splitAddress } from "./lib/tree.js";
import { PS_ARGS, parsePs, withRates, coarseTimes, childIndex, treeUsage } from "./lib/ps.js";
import { DIR_SCRIPT, telemetryDir, isTelemetryFile, parseTelemetry, matchTelemetry, shortModel, modelEffort, limitPercent } from "./lib/telemetry.js";
import { REPO_ARGS, STATUS_ARGS, prArgs, parseRepo, parseStatus, statusParts, statusText, statusNote, codeArgs, sshTarget, pickPr, folderLabel, tilde } from "./lib/git.js";
import { cpuText, memText, costText, percentText, fitColumns, prText, prNote, countWidth } from "./lib/format.js";
import { COLUMNS, parseWidths, sized, dragged } from "./lib/columns.js";
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
});
const STORE = newStore();
const URGENCY = { blocked: 4, done: 3, working: 2, idle: 1, unknown: 0 };
// The top bar's counts in display order; in a narrow bar the least urgent go first.
const COUNTED = ["blocked", "working", "done", "idle", "unknown"];
const WORD_WIDTH = 44; // "Agents" in the top bar

const GAP = 12;
const NAME_MIN = 190;
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
    this.size = null;
    this.folded = new Set();
    this.cursor = null;
    this.here = undefined; // the agent the person is in, as last seen
    this.reveal = null;
    this.lines = [];
    this.widths = {}; // column -> px, as the person dragged them
    this.drag = null; // { key, x, width, most } while a column's border is held
    try {
      this.widths = parseWidths(localStorage.getItem("widths"));
    } catch {
      // No storage here: the columns keep their own widths.
    }
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.running = new Map(); // job -> when it started
    this.data = STORE;
    // Telemetry is this copy's own: `telemetryDir` in props may point each copy somewhere else.
    this.records = new Map(); // machine -> telemetry records
    this.files = new Map(); // this machine's telemetry files: name -> record
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
      this.records = demo.records;
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
    cx.spawn(async (cx) => {
      let changed = false;
      try {
        changed = (await body(cx)) !== false;
      } catch (error) {
        console.warn(`herdr-agents: ${name}: ${error}`);
      } finally {
        if (this.running.get(name) === started) this.running.delete(name);
      }
      if (changed) this.later(cx);
    });
  }

  /** Redraws shortly, once, however many jobs asked: building the rows is the costly part. */
  later(cx) {
    if (this.pending) return;
    this.pending = true;
    cx.timer.after(PUBLISH_MS, (cx) => {
      this.pending = false;
      if (this.digest(this.model()) !== this.shown) cx.notify();
    });
  }

  /** Every machine has jobs of its own: one that is slow or away holds up nobody else. */
  tick(cx) {
    const { machines, folders } = this.targets();
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
      if (machine) this.job(`reach ${key}`, cx, () => this.readReach(machine));
    }
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
      try {
        const read = await this.readHead(machine, top);
        head.branch = read?.branch ?? null;
        head.status = read?.status ?? null;
        head.gone = !read;
      } catch {
        // The folder is gone, or the machine is away. Asked again next time.
        head.branch = null;
        head.status = null;
      }
      head.wait = Math.max(machine ? REMOTE_MS * 2 : BRANCH_MS, (Date.now() - now) * SLOW_GIT);
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
   * not a checkout any more. A git that does not know the status asked gives the branch alone.
   */
  async readHead(machine, top) {
    const where = machine ?? "";
    const git = (args) => exec("git", args, { cwd: top, on: machine, timeout: 10000 });
    const plain = (this.data.plainGit.get(where) ?? 0) > Date.now();
    if (!plain) {
      const out = await git(STATUS_ARGS);
      const status = out.code === 0 ? parseStatus(out.stdout) : null;
      if (status) return { branch: status.branch, status };
    }
    const head = await git(["symbolic-ref", "--short", "-q", "HEAD"]);
    if (head.code !== 0 && head.code !== 1) return null;
    // The branch could be asked for and the status could not: this git is older than the options.
    if (!plain) this.data.plainGit.set(where, Date.now() + PLAIN_GIT_MS);
    if (head.code === 0) return { branch: head.stdout.trim() || null, status: null };
    // No branch: a commit is checked out.
    const commit = await git(["rev-parse", "--short", "HEAD"]);
    return { branch: commit.code === 0 && commit.stdout.trim() ? `@${commit.stdout.trim()}` : null, status: null };
  }

  /** How ssh reaches another machine, for opening its folders in VS Code. Answers whether it changed. */
  async readReach(machine) {
    const held = this.data.reach.get(machine);
    if (held && Date.now() - held.at < REACH_MS) return false;
    let target = held?.target ?? null;
    try {
      const out = await hc(["machine", "ls", "--json"]);
      if (out.code === 0) target = sshTarget(out.stdout, machine);
    } catch {
      // hc did not answer: what was known stays.
    }
    this.data.reach.set(machine, { target, at: Date.now() });
    return target !== (held?.target ?? null);
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
    if (!machine) this.files = files;
    this.records.set(machine ?? "", [...files.values()]);
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
    await Promise.all([...names].map((name) => this.readFile(null, dir, name, this.files)));
    this.records.set("", [...this.files.values()]);
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
        // A session that has just started is not in the last process reading yet, and a file
        // whose process is not running is skipped: read the processes again, once for each
        // new pid (a file left by a crashed session keeps its dead pid for good).
        const pids = (this.records.get("") ?? []).map((record) => record.pid).filter((pid) => pid != null);
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
      for (const [address, record] of matchTelemetry(list, this.records.get(key), table)) telemetry.set(address, record);
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
          tip: [`${terminal.program?.name ?? "agent"} · ${row.address}`, cwd ? tilde(cwd, house) : null, [branch, prNote(pr)].filter(Boolean).join(" · "), statusNote(git), terminal.report?.msg].filter(Boolean).join("\n"),
        };
      }),
    }));
    return { groups, rows: groups.flatMap((group) => group.rows), order };
  }

  /** Everything a redraw would show differently, as one string. */
  digest(model) {
    return model.rows.map((row) => [row.address, row.depth, row.name, row.title, ...COLUMNS.map((column) => cellText(row, column.key)), row.pr?.state ?? "", row.open?.host ?? (row.open ? "here" : ""), row.hidden.join(",")].join("\t")).join("\n");
  }

  /** Opened over the window, the mod goes away once it has taken the person somewhere. */
  leave() {
    const given = props() ?? {};
    if (given.overlay && !given.stay) closeOverlay(given.overlay);
  }

  activate(row, cx) {
    this.cursor = row.address;
    if (!this.demo) {
      run("agent.focus", { terminal: row.address });
      this.leave();
    }
    cx.notify();
  }

  /** Opens the row's folder in VS Code. */
  openDir(row, cx) {
    if (this.demo || !row.open) return;
    const { path, host } = row.open;
    cx.spawn(async () => {
      try {
        const out = await exec("code", codeArgs(path, host), { timeout: 20000 });
        if (out.code !== 0) throw new Error(out.stderr.trim() || `code ended with ${out.code}`);
        this.leave();
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

  // A column's left border is dragged: the columns hold to the right edge, so the border stays
  // under the pointer, the column takes its width from the name, and no more than the name can give.

  dragStart(column, spare, event, cx) {
    cx.stop_propagation();
    if (event.click_count >= 2) {
      // Pressed twice: back to the column's own width.
      const { [column.key]: _own, ...rest } = this.widths;
      this.widths = rest;
      this.drag = null;
      this.saveWidths();
    } else {
      this.drag = { key: column.key, x: event.position.x, width: column.width, most: column.width + Math.max(0, spare) };
    }
    cx.notify();
  }

  dragTo(event, cx) {
    const drag = this.drag;
    if (!drag) return;
    const width = Math.min(dragged(drag.width, event.position.x - drag.x), drag.most);
    if (width === (this.widths[drag.key] ?? drag.width)) return;
    this.widths = { ...this.widths, [drag.key]: width };
    cx.notify();
  }

  dragEnd(cx) {
    if (!this.drag) return;
    this.drag = null;
    this.saveWidths();
    cx.notify();
  }

  saveWidths() {
    try {
      localStorage.setItem("widths", JSON.stringify(this.widths));
    } catch {
      // No storage here: the widths last as long as this copy.
    }
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

  /** Folds a parent's children away; folded, it says how many are hidden and how urgent they are. */
  fold(t, row) {
    const top = row.hidden.reduce((most, status) => (URGENCY[status] > URGENCY[most] ? status : most), "unknown");
    const color = row.folded ? (URGENCY[top] > URGENCY.idle ? t[top] : t.muted) : t.dim;
    return div().id(`fold-${row.address}`).flex_none().px(4).rounded(4).text_size(10.5).text_color(color).cursor_pointer()
      .hover((el) => el.bg(t.raised).text_color(t.foreground))
      .tooltip(row.folded ? "Show its agents" : "Hide its agents")
      .on_click((_event, cx) => { cx.stop_propagation(); this.toggle(row.address, cx); })
      .child(row.folded ? `▸ ${row.hidden.length}` : "▾");
  }

  cell(t, row, column) {
    const text = cellText(row, column.key);
    const box = div().id(`${column.key}-${row.address}`).w(column.width).flex_none().truncate().text_color(this.cellColor(t, row, column.key));
    if (column.key === "status") {
      return h_flex().w(column.width).flex_none().gap(7).items_center().child(this.dot(t, row.status)).child(div().truncate().text_color(this.cellColor(t, row, "status")).child(text));
    }
    if (column.key === "pr" && text) {
      // The merged mark stands outside the number, so a long number cannot cut it off.
      const cellBox = h_flex().id(`${column.key}-${row.address}`).w(column.width).flex_none().gap(4).text_color(this.cellColor(t, row, "pr"))
        .tooltip([prNote(row.pr), row.pr.title].filter(Boolean).join("\n"))
        .child(div().min_w(0).truncate().child(text))
        .when(row.pr.state === "merged", (el) => el.child(div().flex_none().child("✓")));
      if (!row.pr.url) return cellBox;
      return cellBox.cursor_pointer().hover((el) => el.text_color(t.foreground))
        .on_click((_event, cx) => { cx.stop_propagation(); cx.open_url(row.pr.url); });
    }
    if (column.key === "model" && text) {
      // The model and the effort each have a color of their own.
      const model = shortModel(row.tele.model);
      const effort = row.tele.effort;
      return h_flex().id(`${column.key}-${row.address}`).w(column.width).flex_none().overflow_hidden().tooltip(text)
        .when(model, (el) => el.child(div().min_w(0).truncate().text_color(this.cellColor(t, row, "model")).child(model)))
        .when(model && effort, (el) => el.child(div().flex_none().text_color(t.dim).child("/")))
        .when(effort, (el) => el.child(div().flex_none().text_color(this.cellColor(t, row, "effort")).child(effort)));
    }
    if (column.key === "git" && text) {
      return h_flex().id(`${column.key}-${row.address}`).w(column.width).flex_none().gap(5).overflow_hidden().tooltip(statusNote(row.git))
        .children(statusParts(row.git).map((part) => div().flex_none().text_color(t[GIT_COLOR[part.kind]] ?? t.dim).child(part.text)));
    }
    if (column.key === "dir" && text && row.open) {
      // A link: the folder opens in VS Code.
      return box.cursor_pointer().hover((el) => el.underline().text_color(t.foreground))
        .tooltip(`Open ${row.open.host ? `${row.open.host}:` : ""}${row.open.path} in VS Code`)
        .on_click((_event, cx) => { cx.stop_propagation(); this.openDir(row, cx); })
        .child(text);
    }
    return box.when(column.right, (el) => el.text_right()).when(text.length > 12, (el) => el.tooltip(text)).child(text);
  }

  /** The headings. In the gap before each column is its left border, to drag. */
  headings(t, columns, spare) {
    return h_flex().h(20).flex_none().mx(6).px(8).gap(GAP).items_center().text_size(10.5).text_color(t.dim)
      .child(div().flex_1().min_w(0).child("agent"))
      .children(columns.map((column) =>
        div().relative().w(column.width).flex_none()
          .child(div().truncate().when(column.right, (el) => el.text_right()).child(column.label))
          .child(div().id(`border-${column.key}`).absolute().left(-GAP / 2 - 4).top(-2).bottom(-2).w(9).rounded(2).cursor_col_resize()
            .hover((el) => el.bg(t.hover))
            .tooltip("Drag to resize, double-click to reset")
            .on_mouse_down("left", (event, cx) => this.dragStart(column, spare, event, cx))
            .child(div().absolute().left(4).top(3).bottom(3).w(1).bg(this.drag?.key === column.key ? t.accent : t.border)))));
  }

  rowBase(t, row) {
    const here = row.address === this.here;
    return h_flex().id(`row-${row.address}`).flex_none().mx(6).px(8).rounded(6).items_center().cursor_pointer()
      .when(here, (el) => el.bg(t.selected))
      .when(row.address === this.cursor && !here, (el) => el.bg(t.hover))
      .hover((el) => el.bg(t.hover))
      .on_click((_event, cx) => this.activate(row, cx));
  }

  tableRow(t, row, columns) {
    return this.rowBase(t, row).h(26).gap(GAP)
      .child(h_flex().id(`name-${row.address}`).flex_1().min_w(0).self_stretch().gap(6).items_center().tooltip(row.tip)
        .children(this.lead(t, row))
        .child(div().min_w(0).truncate().text_color(row.status === "idle" ? t.muted : t.foreground).child(row.name))
        .when(row.kids, (el) => el.child(this.fold(t, row)))
        .when(row.title, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(row.title))))
      .children(columns.map((column) => this.cell(t, row, column)));
  }

  compactRow(t, row) {
    const about = [
      cellText(row, "dir"),
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
        .when(about, (el) => el.child(div().text_size(11).text_color(t.dim).truncate().child(about))))
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
    const model = this.model();
    this.shown = this.digest(model);
    this.follow(model);
    // A copy in the layout decides the order of agent.next / agent.prev; one opened over the
    // window for a moment leaves it to the list that stays.
    if (!this.demo && (given.order ?? !given.overlay)) setAgentOrder(model.order);

    const width = this.size?.width ?? 640;
    const mode = width < 110 ? "rail" : width < 520 ? "compact" : "table";
    // A column nobody has anything for is left out: no telemetry files, no telemetry columns.
    const filled = sized(COLUMNS, this.widths).filter((column) => model.rows.some((row) => cellText(row, column.key)));
    const room = width - 28 - NAME_MIN - GAP;
    const keys = new Set(fitColumns(filled, room, GAP));
    const columns = filled.filter((column) => keys.has(column.key));
    // What the name has beyond its least: as much as a column can still be widened by.
    const spare = room - columns.reduce((sum, column) => sum + column.width + GAP, -GAP);

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
      return mode === "compact" ? this.compactRow(t, line.row) : this.tableRow(t, line.row, columns);
    };

    return v_flex().id("herdr-agents").size_full().min_h(0).bg(t[given.background] ?? (given.overlay ? t.popover : t.chrome)).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .on_mouse_move((event, cx) => this.dragTo(event, cx))
      .on_mouse_up("left", (_event, cx) => this.dragEnd(cx))
      .on_size_change((size, cx) => {
        const first = !this.size;
        this.size = size;
        // Opened over the window (mod.open): the keyboard is here from the start.
        if (first && props()?.overlay) this.handle.focus();
        cx.notify();
      })
      .when(mode !== "rail", (el) => el.child(this.topBar(t, model, mode, width)))
      .when(mode === "table" && model.rows.length > 0, (el) => el.child(this.headings(t, columns, spare)))
      .when(model.rows.length === 0 && mode !== "rail", (el) => el.child(div().px(14).py(6).text_color(t.dim).child("No agents are running.")))
      .child(v_flex().id("herdr-agents-rows").flex_1().min_h(0).pb(8).overflow_y_scrollbar().track_scroll(this.scroll).children(lines.map(draw)))
      // While a border is held, a sheet over everything keeps the pointer's moves and its
      // release from the rows; a release outside the mod is not heard, so the next press ends it.
      .when(this.drag, (el) => el.child(div().id("herdr-agents-drag").absolute().inset_0().cursor_col_resize()
        .on_mouse_move((event, cx) => this.dragTo(event, cx))
        .on_mouse_up("left", (_event, cx) => this.dragEnd(cx))
        .on_mouse_down("left", (_event, cx) => { cx.stop_propagation(); this.dragEnd(cx); })));
  }
}
