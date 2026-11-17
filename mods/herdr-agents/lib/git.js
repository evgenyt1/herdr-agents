// Folders, git checkouts and pull requests as short labels. No host calls.

const trimSlash = (path) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
const base = (path) => trimSlash(path).split("/").pop() ?? "";
const dir = (path) => {
  const cut = trimSlash(path).lastIndexOf("/");
  return cut <= 0 ? "/" : trimSlash(path).slice(0, cut);
};

/** A path as git prints it (maybe relative, with `..`) -> absolute, against `from`. POSIX paths. */
export function resolvePath(from, path) {
  const joined = String(path).startsWith("/") ? String(path) : `${from}/${path}`;
  const out = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/**
 * `git rev-parse` arguments whose output `parseRepo` reads. Git before 2.31 does not know
 * `--path-format`: it prints the option back and answers with relative paths, which is read too.
 */
export const REPO_ARGS = ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--git-dir", "--show-prefix"];

/**
 * Output of `git rev-parse` with REPO_ARGS run in `cwd` -> { top, common, repo, worktree, below }:
 * the checkout's folder, the repository's shared git folder, the repository's name, the
 * checkout's name when it is a linked worktree (else null), and the folder below the checkout.
 */
export function parseRepo(stdout, cwd) {
  const lines = String(stdout ?? "").split("\n").map((line) => line.trim());
  if (lines[0]?.startsWith("--")) lines.shift();
  if (!lines[0] || !lines[1]) return null;
  const top = trimSlash(lines[0]);
  const common = resolvePath(cwd, lines[1]);
  const own = lines[2] ? resolvePath(cwd, lines[2]) : common;
  // The git folder is `.git` in the main checkout, or a bare repository: `app.git`, or
  // `app/.bare` with the worktrees beside it.
  const hidden = base(common) === ".git" || base(common) === ".bare";
  const repo = hidden ? base(dir(common)) : base(common).replace(/\.git$/, "");
  // A linked worktree has a git folder of its own inside the shared one.
  return { top, common, repo, worktree: own !== common ? base(top) : null, below: trimSlash(lines[3] ?? "") };
}

/** A folder with the home folder as `~`. */
export function tilde(path, home) {
  const root = home ? trimSlash(home) : null;
  if (root && path === root) return "~";
  if (root && path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`;
  return path;
}

/**
 * What a row says about where an agent is: { main, detail }.
 * In a repository: its name, then the worktree and the folder below the checkout, if any.
 * Elsewhere: the last two folders, with the home folder as `~`.
 */
export function folderLabel(cwd, repo, home) {
  if (!cwd) return { main: "", detail: "" };
  if (repo) return { main: repo.repo, detail: [repo.worktree, repo.below].filter(Boolean).join(" / ") };
  const short = tilde(trimSlash(cwd), home);
  const parts = short.split("/").filter(Boolean);
  if (parts.length <= 2) return { main: short, detail: "" };
  return { main: `…/${parts.slice(-2).join("/")}`, detail: "" };
}

/**
 * `gh pr list` for the pull requests whose head is `branch`, with the fields `pickPr` reads.
 * By head, not `gh pr view <branch>`: there a branch named `123` would be read as a number.
 */
export const prArgs = (branch) => ["pr", "list", "--head", branch, "--state", "all", "--limit", "20", "--json", "number,state,isDraft,url,title,isCrossRepository"];

/**
 * Output of `gh pr list` with `prArgs` -> the branch's pull request { number, state, url, title },
 * or null when it has none. gh lists the newest first: an open one wins, else the newest.
 * Pull requests from a fork's branch of the same name are not this branch's.
 */
export function pickPr(stdout) {
  let list;
  try {
    list = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const own = list.filter((raw) => raw && typeof raw.number === "number" && raw.isCrossRepository !== true);
  const raw = own.find((one) => String(one.state).toLowerCase() === "open") ?? own[0];
  if (!raw) return null;
  const word = String(raw.state ?? "").toLowerCase();
  const state = word === "open" ? (raw.isDraft ? "draft" : "open") : word === "merged" ? "merged" : "closed";
  return { number: raw.number, state, url: typeof raw.url === "string" ? raw.url : null, title: typeof raw.title === "string" ? raw.title : "" };
}

/**
 * `git` arguments for a checkout's branch and what has changed in it, read by `parseStatus`.
 * `--no-optional-locks`: a status otherwise takes the index lock to write the index back, and
 * an agent's own git in that checkout would find it locked.
 */
export const STATUS_ARGS = ["--no-optional-locks", "status", "--porcelain=v2", "--branch"];

/**
 * Output of `git` with STATUS_ARGS -> { branch, upstream, gone, ahead, behind, staged, modified,
 * untracked, conflicts }, or null for no output. `branch` is the branch, `@9f8e7d6` when a
 * commit is checked out, null before the first commit of a checkout without a branch. `gone`:
 * the upstream it names is not there any more (git then says nothing of ahead and behind). The
 * counts are lines of the status: a file both staged and changed again counts in both, an
 * untracked folder counts once.
 */
export function parseStatus(stdout) {
  const lines = String(stdout ?? "").split("\n").filter(Boolean);
  if (!lines.length) return null;
  const status = { branch: null, upstream: null, gone: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  let head = null;
  let commit = null;
  let far = false;
  for (const line of lines) {
    const kind = line[0];
    if (kind === "#") {
      const [, name, ...rest] = line.split(" ");
      if (name === "branch.oid") commit = rest[0];
      else if (name === "branch.head") head = rest.join(" ");
      else if (name === "branch.upstream") status.upstream = rest.join(" ") || null;
      else if (name === "branch.ab") {
        far = true;
        status.ahead = Math.abs(parseInt(rest[0], 10)) || 0;
        status.behind = Math.abs(parseInt(rest[1], 10)) || 0;
      }
    } else if (kind === "1" || kind === "2") {
      // "1 XY ...": X is the index against the last commit, Y the folder against the index.
      if (line[2] !== ".") status.staged += 1;
      if (line[3] !== ".") status.modified += 1;
    } else if (kind === "u") status.conflicts += 1;
    else if (kind === "?") status.untracked += 1;
  }
  status.gone = status.upstream != null && !far;
  if (head && head !== "(detached)") status.branch = head;
  else if (commit && commit !== "(initial)") status.branch = `@${commit.slice(0, 7)}`;
  return status;
}

// What a status shows, in the order shown, each with its mark and its word.
const PARTS = [
  ["conflicts", "!", "in conflict"],
  ["staged", "+", "staged"],
  ["modified", "~", "modified"],
  ["untracked", "?", "untracked"],
  ["ahead", "↑", "ahead"],
  ["behind", "↓", "behind"],
];

/** A status as short marks: [{ kind, text }], e.g. `+4`, `~3`, `↑2`; one `✓` when nothing is to say. */
export function statusParts(status) {
  if (!status) return [];
  const parts = PARTS.filter(([kind]) => status[kind] > 0).map(([kind, mark]) => ({ kind, text: `${mark}${status[kind]}` }));
  return parts.length ? parts : [{ kind: "clean", text: "✓" }];
}

/**
 * The marks a cell `width` px wide has room for, by a guess of `char` px a character with
 * `gap` px between marks; when some do not fit, an ellipsis stands for them (`kind: "more"`).
 * A mark is shown whole or not at all: a number cut short would read as another number.
 */
export function fitParts(parts, width, gap = 5, char = 7.5) {
  const wide = (part) => part.text.length * char;
  if (parts.reduce((sum, part, index) => sum + (index ? gap : 0) + wide(part), 0) <= width) return parts;
  const kept = [];
  let used = char; // the ellipsis
  for (const part of parts) {
    used += wide(part) + gap;
    if (used > width) break;
    kept.push(part);
  }
  return [...kept, { kind: "more", text: "…" }];
}

/** The marks as one text: "+4 ~3 ↑2". */
export const statusText = (status) => statusParts(status).map((part) => part.text).join(" ");

/** A status in words, for a tip: "4 staged, 3 modified · 2 ahead, 1 behind origin/main". */
export function statusNote(status) {
  if (!status) return "";
  const words = (kinds) => PARTS.filter(([kind]) => kinds.includes(kind) && status[kind] > 0).map(([kind, , word]) => `${status[kind]} ${word}`);
  const changes = words(["conflicts", "staged", "modified", "untracked"]).join(", ") || "clean";
  if (!status.upstream) return `${changes} · no upstream`;
  if (status.gone) return `${changes} · ${status.upstream} is gone`;
  const far = words(["ahead", "behind"]);
  const link = far.length ? `${far.join(", ")}${status.behind ? "" : " of"}` : "up to date with";
  return `${changes} · ${link} ${status.upstream}`;
}

/** Arguments for VS Code's `code` to open a folder: here, or on a machine reached with ssh. */
export const codeArgs = (path, host) => (host ? ["--remote", `ssh-remote+${host}`, path] : [path]);

/**
 * Output of `hc machine ls --json` -> how ssh reaches the machine called `name`, as VS Code can
 * be told it, or null: when the machine is not listed, is reached with a command of its own
 * (`via`), or on a port of its own (`can@10.0.0.7:2222`), which `ssh-remote+` has no place for.
 */
export function sshTarget(stdout, name) {
  let list;
  try {
    list = JSON.parse(stdout)?.machines;
  } catch {
    return null;
  }
  const machine = Array.isArray(list) ? list.find((one) => one?.name === name) : null;
  const target = machine && !machine.via && typeof machine.target === "string" ? machine.target.trim() : "";
  return target && !/:\d+$/.test(target) && !/\s/.test(target) ? target : null;
}
