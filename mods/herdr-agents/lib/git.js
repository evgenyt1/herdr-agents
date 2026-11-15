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
