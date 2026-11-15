import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePath, parseRepo, tilde, folderLabel, pickPr, prArgs } from "../mods/herdr-agents/lib/git.js";

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
