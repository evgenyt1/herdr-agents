import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePath, parseRepo, tilde, folderLabel, pickPr, prArgs, STATUS_ARGS, parseStatus, statusParts, fitParts, partsWidth, statusText, statusNote, codeArgs, sshTarget } from "../mods/herdr-agents/lib/git.js";

test("resolvePath makes git's relative answers absolute", () => {
  assert.equal(resolvePath("/a/b", ".git"), "/a/b/.git");
  assert.equal(resolvePath("/a/b/c", "../../.git"), "/a/.git");
  assert.equal(resolvePath("/a/b", "/x/y/.git"), "/x/y/.git");
  assert.equal(resolvePath("/a/b", "./c/"), "/a/b/c");
});

// What `git rev-parse --show-toplevel --git-common-dir --git-dir --show-prefix` prints.
const out = (...lines) => `${lines.join("\n")}\n`;

test("parseRepo: the main checkout, and a folder below it", () => {
  assert.deepEqual(parseRepo(out("/src/app", "/src/app/.git", "/src/app/.git", ""), "/src/app"), { top: "/src/app", common: "/src/app/.git", repo: "app", worktree: null, below: "" });
  assert.deepEqual(parseRepo(out("/src/app", "/src/app/.git", "/src/app/.git", "pkg/core/"), "/src/app/pkg/core"), { top: "/src/app", common: "/src/app/.git", repo: "app", worktree: null, below: "pkg/core" });
});

test("parseRepo: older git answers with relative paths", () => {
  assert.deepEqual(parseRepo(out("/src/app", "../../.git", "/src/app/.git", "pkg/core/"), "/src/app/pkg/core"), { top: "/src/app", common: "/src/app/.git", repo: "app", worktree: null, below: "pkg/core" });
  assert.deepEqual(parseRepo(out("--path-format=absolute", "/src/app", ".git", ".git", ""), "/src/app"), { top: "/src/app", common: "/src/app/.git", repo: "app", worktree: null, below: "" });
});

test("parseRepo: a folder reached through a link is still the main checkout", () => {
  // git answers with the real path; the terminal's folder is the linked one.
  assert.deepEqual(parseRepo(out("/private/tmp/x", "/private/tmp/x/.git", "/private/tmp/x/.git", "sub/"), "/tmp/x/sub"), { top: "/private/tmp/x", common: "/private/tmp/x/.git", repo: "x", worktree: null, below: "sub" });
});

test("parseRepo: a linked worktree is named, the repository is still the main one", () => {
  assert.deepEqual(parseRepo(out("/src/trees/fix", "/src/app/.git", "/src/app/.git/worktrees/fix", ""), "/src/trees/fix"), {
    top: "/src/trees/fix",
    common: "/src/app/.git",
    repo: "app",
    worktree: "fix",
    below: "",
  });
});

test("parseRepo: worktrees of a bare repository, and not a repository", () => {
  const beside = parseRepo(out("/src/trees/fix", "/src/app.git", "/src/app.git/worktrees/fix", ""), "/src/trees/fix");
  assert.deepEqual([beside.repo, beside.worktree], ["app", "fix"]);
  const inside = parseRepo(out("/src/app/feature-x", "/src/app/.bare", "/src/app/.bare/worktrees/feature-x", "docs/"), "/src/app/feature-x/docs");
  assert.deepEqual([inside.repo, inside.worktree, inside.below], ["app", "feature-x", "docs"]);
  assert.equal(parseRepo("", "/tmp"), null);
  assert.equal(parseRepo("/only-one-line\n", "/tmp"), null);
});

test("tilde shortens the home folder only", () => {
  assert.equal(tilde("/home/me", "/home/me"), "~");
  assert.equal(tilde("/home/me/src", "/home/me/"), "~/src");
  assert.equal(tilde("/home/meow/src", "/home/me"), "/home/meow/src");
  assert.equal(tilde("/srv/app", null), "/srv/app");
});

test("folderLabel: repository, worktree and the folder below", () => {
  const repo = (worktree, below) => ({ top: "/x", common: "/src/app/.git", repo: "app", worktree, below });
  assert.deepEqual(folderLabel("/src/app", repo(null, ""), "/home/me"), { main: "app", detail: "" });
  assert.deepEqual(folderLabel("/src/app/pkg/core", repo(null, "pkg/core"), "/home/me"), { main: "app", detail: "pkg/core" });
  assert.deepEqual(folderLabel("/src/trees/fix", repo("fix", ""), "/home/me"), { main: "app", detail: "fix" });
  assert.deepEqual(folderLabel("/src/trees/fix/docs", repo("fix", "docs"), "/home/me"), { main: "app", detail: "fix / docs" });
});

test("folderLabel outside a repository: short, home as ~", () => {
  assert.deepEqual(folderLabel("/home/me", null, "/home/me"), { main: "~", detail: "" });
  assert.deepEqual(folderLabel("/home/me/notes", null, "/home/me"), { main: "~/notes", detail: "" });
  assert.deepEqual(folderLabel("/home/me/a/b/c", null, "/home/me"), { main: "…/b/c", detail: "" });
  assert.deepEqual(folderLabel("/srv", null, "/home/me"), { main: "/srv", detail: "" });
  assert.deepEqual(folderLabel(null, null, "/home/me"), { main: "", detail: "" });
});

test("pickPr reads gh's list: an open one first, else the newest, never a fork's", () => {
  const pr = (more) => ({ number: 12, state: "OPEN", isDraft: false, url: "https://example.test/pr/12", title: "Fix it", isCrossRepository: false, ...more });
  const pick = (...list) => pickPr(JSON.stringify(list));
  assert.deepEqual(pick(pr({})), { number: 12, state: "open", url: "https://example.test/pr/12", title: "Fix it" });
  assert.equal(pick(pr({ isDraft: true })).state, "draft");
  assert.equal(pick(pr({ state: "MERGED" })).state, "merged");
  assert.equal(pick(pr({ state: "CLOSED", isDraft: true })).state, "closed");
  assert.equal(pick(pr({ number: 30, state: "CLOSED" }), pr({ number: 20 }), pr({ number: 10, state: "MERGED" })).number, 20);
  assert.equal(pick(pr({ number: 30, state: "CLOSED" }), pr({ number: 10, state: "MERGED" })).number, 30);
  assert.equal(pick(pr({ number: 99, isCrossRepository: true }), pr({ number: 7, state: "MERGED" })).number, 7);
  assert.equal(pick(pr({ isCrossRepository: true })), null);
  assert.equal(pick(), null);
  assert.equal(pickPr("no pull requests"), null);
  assert.equal(pickPr("{}"), null);
});

test("prArgs asks for the branch's pull requests by head, so a branch named like a number stays a branch", () => {
  assert.deepEqual(prArgs("123").slice(0, 4), ["pr", "list", "--head", "123"]);
  assert.ok(prArgs("123").includes("all"));
});

// What `git status --porcelain=v2 --branch` prints.
const STATUS = [
  "# branch.oid 9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
  "# branch.head feat/cart",
  "# branch.upstream origin/feat/cart",
  "# branch.ab +2 -1",
  "1 M. N... 100644 100644 100644 1111111 2222222 staged.js",
  "1 .M N... 100644 100644 100644 1111111 1111111 modified.js",
  "1 MM N... 100644 100644 100644 1111111 2222222 both.js",
  "1 A. N... 000000 100644 100644 0000000 2222222 added.js",
  "1 .D N... 100644 100644 000000 1111111 1111111 deleted.js",
  "2 R. N... 100644 100644 100644 1111111 1111111 R100 new name.js\told name.js",
  "2 RM N... 100644 100644 100644 1111111 1111111 R090 moved.js\twas.js",
  "1 .M S.M. 160000 160000 160000 1111111 1111111 vendor/lib",
  "u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 conflict.js",
  "? notes.txt",
  "? scratch/",
  "! ignored.log",
  "",
].join("\n");

test("STATUS_ARGS asks without taking the index lock an agent's own git may want", () => {
  assert.deepEqual(STATUS_ARGS, ["--no-optional-locks", "status", "--porcelain=v2", "--branch"]);
});

test("parseStatus counts what changed and how far the branch is from its upstream", () => {
  assert.deepEqual(parseStatus(STATUS), { branch: "feat/cart", upstream: "origin/feat/cart", gone: false, ahead: 2, behind: 1, staged: 5, modified: 5, untracked: 2, conflicts: 1 });
});

test("parseStatus: a clean checkout, no upstream, a commit checked out, no commit yet", () => {
  assert.deepEqual(parseStatus("# branch.oid 9f8e7d6c5b\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n"), { branch: "main", upstream: "origin/main", gone: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 });
  assert.deepEqual(parseStatus("# branch.oid 9f8e7d6c5b\n# branch.head topic\n"), { branch: "topic", upstream: null, gone: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 });
  assert.equal(parseStatus("# branch.oid 9f8e7d6c5b4a3928\n# branch.head (detached)\n").branch, "@9f8e7d6");
  assert.equal(parseStatus("# branch.oid (initial)\n# branch.head main\n? a.txt\n").branch, "main");
  assert.equal(parseStatus("# branch.oid (initial)\n# branch.head (detached)\n").branch, null);
  // An upstream that is gone is named, with nothing to count: git leaves the `branch.ab` line out.
  const gone = parseStatus("# branch.oid 9f8e\n# branch.head old\n# branch.upstream origin/old\n");
  assert.deepEqual([gone.upstream, gone.gone, gone.ahead, gone.behind], ["origin/old", true, 0, 0]);
  assert.equal(statusNote(gone), "clean · origin/old is gone");
  assert.equal(parseStatus(""), null);
  assert.equal(parseStatus(null), null);
});

test("statusParts, statusText and statusNote say it short and in words", () => {
  const status = parseStatus(STATUS);
  assert.deepEqual(statusParts(status), [
    { kind: "conflicts", text: "!1" },
    { kind: "staged", text: "+5" },
    { kind: "modified", text: "~5" },
    { kind: "untracked", text: "?2" },
    { kind: "ahead", text: "↑2" },
    { kind: "behind", text: "↓1" },
  ]);
  assert.equal(statusText(status), "!1 +5 ~5 ?2 ↑2 ↓1");
  assert.equal(statusNote(status), "1 in conflict, 5 staged, 5 modified, 2 untracked · 2 ahead, 1 behind origin/feat/cart");
  const clean = parseStatus("# branch.oid 9f8e\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n");
  assert.deepEqual(statusParts(clean), [{ kind: "clean", text: "✓" }]);
  assert.equal(statusNote(clean), "clean · up to date with origin/main");
  const ahead = parseStatus("# branch.oid 9f8e\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +3 -0\n");
  assert.equal(statusText(ahead), "↑3");
  assert.equal(statusNote(ahead), "clean · 3 ahead of origin/main");
  const behind = parseStatus("# branch.oid 9f8e\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -2\n");
  assert.equal(statusText(behind), "↓2");
  assert.equal(statusNote(behind), "clean · 2 behind origin/main");
  assert.equal(statusNote(parseStatus("# branch.oid 9f8e\n# branch.head topic\n? a\n")), "1 untracked · no upstream");
  assert.deepEqual(statusParts(null), []);
  assert.equal(statusText(null), "");
  assert.equal(statusNote(null), "");
});

test("codeArgs opens a folder here, or on a machine reached with ssh", () => {
  assert.deepEqual(codeArgs("/home/dev/src/webshop"), ["/home/dev/src/webshop"]);
  assert.deepEqual(codeArgs("/srv/api", "can@10.0.0.7"), ["--remote", "ssh-remote+can@10.0.0.7", "/srv/api"]);
});

test("sshTarget finds how a machine is reached in `hc machine ls --json`", () => {
  const listing = JSON.stringify({ machines: [
    { name: "vps", target: "can@10.0.0.7", via: false, state: "connected" },
    { name: "box", target: "fly ssh console -a box --pty=false -C", via: true },
    { name: "old", target: "old.example" },
  ] });
  assert.equal(sshTarget(listing, "vps"), "can@10.0.0.7");
  assert.equal(sshTarget(listing, "old"), "old.example");
  // Reached with a command of its own: VS Code has no way there.
  assert.equal(sshTarget(listing, "box"), null);
  assert.equal(sshTarget(listing, "nobody"), null);
  // A port of its own: `ssh-remote+` has no place for it.
  assert.equal(sshTarget(JSON.stringify({ machines: [{ name: "vps", target: "can@10.0.0.7:2222" }] }), "vps"), null);
  assert.equal(sshTarget(JSON.stringify({ machines: [{ name: "vps" }, { name: "odd", target: 7 }] }), "vps"), null);
  assert.equal(sshTarget(JSON.stringify({ machines: [{ name: "odd", target: 7 }] }), "odd"), null);
  assert.equal(sshTarget("not json", "vps"), null);
  assert.equal(sshTarget("{}", "vps"), null);
});

test("fitParts: marks that do not fit the cell give way to an ellipsis, whole marks only", () => {
  const parts = [{ kind: "staged", text: "+12" }, { kind: "modified", text: "~34" }, { kind: "untracked", text: "?15" }, { kind: "ahead", text: "↑2" }, { kind: "behind", text: "↓11" }];
  // 10 px a character, 5 px between marks.
  assert.deepEqual(fitParts(parts, 200, 5, 10), parts);
  assert.deepEqual(fitParts(parts, 160, 5, 10), parts);
  assert.deepEqual(fitParts(parts, 159, 5, 10).map((part) => part.text), ["+12", "~34", "?15", "↑2", "…"]);
  assert.deepEqual(fitParts(parts, 84, 5, 10).map((part) => part.text), ["+12", "~34", "…"]);
  assert.deepEqual(fitParts(parts, 44, 5, 10).map((part) => part.text), ["…"]);
  assert.equal(fitParts(parts, 84, 5, 10).at(-1).kind, "more");
  assert.deepEqual(fitParts([{ kind: "clean", text: "✓" }], 28), [{ kind: "clean", text: "✓" }]);
  assert.deepEqual(fitParts([], 28), []);
});

test("partsWidth: the room fitParts takes a row of marks to need", () => {
  const parts = [{ kind: "conflicts", text: "!1" }, { kind: "staged", text: "+3" }, { kind: "ahead", text: "↑2" }];
  assert.equal(partsWidth(parts, 5, 10), 70);
  assert.equal(partsWidth([], 5, 10), 0);
  // A cell made as wide as that shows every mark.
  assert.deepEqual(fitParts(parts, partsWidth(parts)), parts);
  assert.equal(fitParts(parts, partsWidth(parts) - 1).at(-1).kind, "more");
});
