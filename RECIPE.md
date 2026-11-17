# herdr-agents

A table of every agent Herdr knows, one row each, on this machine and the others: what it is
doing, whose helper it is, where it sits in the window, the repository, branch and pull request
it works on, what has changed there, and how much CPU and memory it uses. When the agent's
session keeps an [agent-telemetry](https://github.com/evgenyt1/agent-telemetry) file, the row
also shows its model, effort, how full its context is, its limits and its cost. Clicking a row
goes to that agent; clicking its folder opens the folder in VS Code.

![herdr-agents](preview.png)

## What you see

Top to bottom, on the theme's `chrome` background (`popover` when opened over the window), text
12.5px:

1. **Top bar**, 36px, all of it 11.5px: the word "Agents" (`muted`, medium weight), then one
   status dot with a count (`dim`) for each status that has agents, in the order blocked,
   working, done, idle, then agents Herdr has no status for; on the right, in the table layout
   only, the totals `CPU 204%  ·  6.1G  ·  $21.55` (`dim`). Agents folded away are counted. A
   bar too narrow for all of it gives up the word first, then counts, the least urgent first:
   no status, idle, working, done; blocked stays longest.
2. **Column headings**, 20px, 10.5px `dim`, in the table layout and only when there are rows:
   `agent`, then the columns below. In the middle of the gap before each column's heading
   stands a 1px line (`border`), its left border, which can be dragged. With no agents, the
   line "No agents are running." (`dim`) stands there.
3. **Rows**, scrolling. Each space starts with a 24px heading (11px, medium, `dim`): the space's
   name, and the machine's name in a small `raised` pill when it is another machine. Under it,
   that space's agents as a tree: an agent started by another agent sits under it, 16px further
   in for each level, joined by 1px lines (`input` color; `border` in a theme without it) drawn
   the full row height so they meet between rows.

A table row is 26px, with 12px between columns:

| Column | Width | Shows | Color |
| --- | --- | --- | --- |
| agent | the rest, 190px at least | tree lines, the program's 14px icon (a picture as it is, a one-color glyph in `muted`), the name (the terminal's name, else its title, else its program), the fold control on a row with helpers, then the title in `dim` when it adds something | `foreground`; `muted` when idle |
| status | 82 | an 8px dot and `working`, `needs you`, `done` or `idle` | the status color |
| model/effort | 124 | `opus-5.5/xhigh`: the model without `claude-` and without a date stamp, its version with a dot, then `/` (`dim`) and the effort as the file gives it; either alone when the other is missing. A long model is cut, the effort is not | the model and the effort each on the green-to-red scale below; `muted` when not known |
| ctx | 38, right | percent of the context window used | the scale: 0 green, 50 yellow, 100 red |
| 7d | 36, right | percent of the seven-day limit used | the same |
| tab | 96 | the tab's name; `tab 2` when the name is only digits (a tab nobody named); `notes · tab 2` when the agent's tab is in another space than the one the row is listed under | `dim` |
| dir | 150 | the repository's name, then ` › ` and the worktree and the folder below the checkout, those two joined by ` / ` (`webshop › cart-totals / src`); outside a repository the path with home as `~` when it is one or two folders (`~/notes`), else `…/` and the last two. A link | `dim`; under the pointer `foreground` and underlined |
| git | 84 | what changed in the checkout, as marks with 5px between them, in this order: `!1` files in conflict, `+3` staged, `~1` modified, `?2` untracked, `↑2` commits ahead of the upstream, `↓1` behind it; `✓` alone when none of these | `!` `ansi1` (red), `+` `ansi2` (green), `~` `ansi3` (yellow), `?` `ansi4` (blue), `↑` `ansi6` (cyan), `↓` `ansi5` (magenta), `✓` `ansi2` |
| branch | 136 | the branch; `@9f8e7d6` when a commit is checked out | `muted` |
| PR | 58 | `#128`; `#126 ✓` when merged, the mark standing outside the number so a long number is cut and the mark is not; nothing when closed | open `accent`, draft `muted`, merged `dim` |
| CPU | 44, right | `0%`, `3.2%`, `145%`: the load of the agent's process and everything it started, 100% being one core | `muted`; `foreground` from 50% |
| mem | 44, right | `84M`, `1.3G` of the same processes | `dim` |
| 5h | 36, right | percent of the five-hour limit used | the scale, as ctx |
| cost | 54, right | `$0.42`, `$118` | `dim` |

**The green-to-red scale** is made of the theme's `ansi2` (green), `ansi3` (yellow) and `ansi1`
(red), never of fixed colors: a level from 0 to 1 is green at 0, yellow at one half, red at 1,
and between them the two neighbors mixed channel by channel (one quarter is yellow-green,
three quarters orange).

- A percentage (ctx, 7d, 5h) is its own level: 37% is 0.37.
- A model, by one word of its name: `haiku`, `mini`, `nano` 0; `sonnet` 0.25; `opus` 0.75;
  `fable`, `mythos`, `max`, `sol` 1; a name with `gpt` or `codex` and none of those words 0.5.
- An effort: `low` (and `minimal`, `none`) 0, `medium` 0.25, `high` 0.5, `xhigh` 0.75, `max` 1.

A column no agent has anything for is left out: without telemetry files the five telemetry
columns are not there. When the block is too narrow for all of them, columns go in this order,
first to go first: 5h, cost, tab, mem, CPU, PR, git, dir, branch, 7d, ctx, model/effort; status
stays.

Under 520px wide the rows become two lines: icon, name and, right after the name, the fold
control above; folder, branch with the git marks (none for a clean checkout) and pull request
(`#126 ✓` when merged), model/effort, CPU and memory in one `dim` 11px line below, joined by
` · ` and cut at the end when too long; the context percent (in its scale color) and the status
dot on the right. Under 110px it is a rail: a column of
status dots, 24px each, no headings.

![Two narrow copies and a rail](docs/narrow.png)

## How it behaves

- **Statuses**, in the theme's own `working`, `blocked`, `done` and `idle` colors: working is a
  filled dot that fades between 30% and 100% every 1.4 s; blocked ("needs you") and done are
  filled and still; idle is a 1.5px ring. An agent Herdr has no status for gets a ring in
  `unknown`.
- **Click a row**, or Enter on the row under the keyboard: Herdr goes to that agent
  (`agent.focus`). Opened over the window, the mod then closes, unless the `stay` prop is set.
- **Keys**, when the block has the keyboard: Down/`j`, Up/`k`, Home, End move the row marked
  with `hover`; Left folds a row's helpers, Right shows them again. The marked row starts on
  the agent the person is in (the pane with the focus) and goes back to it whenever the focus
  moves to another agent, scrolled into view, so the keys move from where the person is.
- **The fold control** (`▾`; folded `▸ 3`, the count of agents hidden) folds a row's helpers
  away. Folded, it takes the color of the most urgent hidden status (blocked, then done, then
  working), and hidden agents still count in the top bar.
- **Click a pull request number**: it opens in the browser. Hovering it shows `#126 merged` and
  its title.
- **Click the dir cell**: the agent's folder opens in VS Code (`code <folder>`); the rest of
  the row keeps its own click. Opened over the window, the mod then closes, like after a row
  click. On another machine the folder opens over ssh (`code --remote ssh-remote+<target>
  <folder>`, run on this machine) when the machine is reached with ssh; on one reached with a
  command of its own the cell is plain text. When `code` cannot be started, a warning toast
  says so. Hovering the cell shows `Open <folder> in VS Code`.
- **Hover the git cell**: the marks in words, `4 staged, 3 modified · 2 ahead, 1 behind
  origin/main`; `clean · up to date with origin/main`; `… · no upstream`.
- **Drag a column's left border** (the line before its heading; the pointer becomes a column
  resize one, the line turns `accent` while held): the columns hold to the right edge, so the
  border stays under the pointer, the column right of it gets wider or narrower (28 to 480px),
  everything left of it moves along and the name takes or gives the room; a column grows no
  further than the name can give (down to its 190px). A double-click on the border gives the
  column its own width back. The widths are kept in the mod's `localStorage` (`widths`, JSON,
  column key to px) and read again when the mod opens.
- **Hover** a row: `hover` background; over the name (the whole row when it has two lines, the
  dot in the rail shows the name), a tip with the program, the terminal's address, the full
  folder, the branch and pull request, the git marks in words, and the agent's last report.
  The row of the focused agent has the `selected` background.
- The order of the rows is also the order of `agent.next` and `agent.prev`, unless the mod was
  opened over the window or the `order` prop says otherwise.
- Nothing else moves. Rows redraw when something they show changes. On this machine processes
  are read every 5 s (the `refresh` prop), branches and changes every 10 s, a telemetry file
  within a second of its change. On another machine processes are read every 15 s, branches,
  changes and the telemetry folder every 30 s. Pull requests are asked every 2 minutes (5 when
  there is none).

## Built from

- One mod, `mods/herdr-agents/`: `main.js` (the view and the background reading), `lib/` (pure
  parts: `tree.js`, `ps.js`, `git.js`, `telemetry.js`, `format.js`, `columns.js`, `colors.js`),
  `demo.js` (made-up agents for the preview). `mod.json`: `{ "place": "none", "title": "Agents", "focusable": true,
  "overlay": { "width": 0.8, "height": 0.7 } }`. No layout, no keys, no shipped mods, no art.
- Props: `refresh` (seconds, 5), `telemetryDir`, `order`, `stay`, `background` (a theme color
  name), `demo`.
- `herdr` functions: `terminals()`, `agents()`, `spaces()` for the rows (an agent is a live
  terminal with a status, or whose program is marked as an agent; its `parent` gives the tree;
  the space and tab come from `agents()`, or from the nearest parent that has them);
  `exec(..., { on })` and `readTextFile(..., { on })` for everything read, here or on another
  machine; `watchFolder` for the telemetry folder; `setAgentOrder`; `run("agent.focus",
  { terminal })`; `closeOverlay`; `focused().agent` for the agent the person is in, when no
  entry of `agents()` is marked `focused`; `hc(["machine", "ls", "--json"])` for how another
  machine is reached (`target`, and `via` when that is a command, not ssh), asked every 10
  minutes; `notify` for the toast; `nextCommand` (it has no commands, the loop only ends on
  reload); `props`, `home`, `theme`. Element handlers for the resizing: `on_mouse_down("left")`
  on the border (its `click_count` tells the double-click, `position.x` where the drag began),
  `on_mouse_move` and `on_mouse_up("left")` on the root.
- Programs, all read-only but `code`, never started from `render`: from a timer
  (`cx.timer.every`), except the watch of this machine's telemetry folder, which is a `cx.spawn`
  loop started in `init`, and `code`, which a click starts:
  - `ps -axo pid=,ppid=,pcpu=,rss=,time=` per machine. CPU is the CPU time the agent's process
    tree gained between two readings about 20 s apart (a minute where `ps` counts whole
    seconds), not `pcpu`, which on Linux is the average since the process started.
  - `git rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir
    --show-prefix`, once per folder, for the checkout it is in. Then, once per checkout however
    many agents are in it, `git --no-optional-locks status --porcelain=v2 --branch`: its
    `# branch.head` line is the branch (`(detached)`: the first seven characters of
    `# branch.oid`), `# branch.upstream` and `# branch.ab +2 -1` the upstream and how far from
    it, a `1` or `2` line a changed file (second character of `XY` not `.`: staged; third not
    `.`: modified), a `u` line a conflict, a `?` line an untracked one. A status is asked again
    no sooner than 20 times as long as the last one took. Where git is too old for this (the
    status fails and the next call does not), `git symbolic-ref --short -q HEAD` gives the
    branch alone (exit 1: a commit is checked out, ask `git rev-parse --short HEAD`), and the
    status is tried again after 10 minutes.
  - `code <folder>`, or `code --remote ssh-remote+<target> <folder>`, on this machine, only
    when a dir cell is clicked.
  - `gh pr list --head <branch> --state all --limit 20 --json
    number,state,isDraft,url,title,isCrossRepository`, per repository and branch.
  - `gh --version`, only after a `gh` call could not be started, to tell a machine without `gh`
    (ask again in 10 minutes) from one that is away (in 1 minute).
  - `sh -c 'printf %s "${AGENT_TELEMETRY_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/agent-telemetry}"'`
    for the telemetry folder: on this machine when no `telemetryDir` prop is given, and on every
    other machine. `sh -c 'printf %s "$HOME"'` once on another machine, for `~` in its folders.
  - `ls -1 <folder>` to list the telemetry folder on another machine, and on this one when the
    folder is outside what a mod may list itself.
- Telemetry: files `<agent>-<session>.json`, format v1, in `$AGENT_TELEMETRY_DIR`, else
  `$XDG_CACHE_HOME/agent-telemetry`, else `~/.cache/agent-telemetry`. A file belongs to the
  terminal named in `terminal.hc`, else to the terminal whose program is its `pid` or started
  it.
- Processes, branches, changes, pull requests, other machines' home folders and how they are
  reached are kept in one object
  for the whole module, so a second copy of the mod, or one opened again, shows them at once
  and does not ask twice. Telemetry records are kept by each copy: copies may be given
  different folders.

## Watch out

- Never keep `cx` past a callback, and never call `exec` from `render`: a draw must not wait.
- `fs` calls throw at once, not as a rejected promise, for paths outside the home folder; only
  `try { await ... }` catches that, and an uncaught one silently ends a `cx.spawn` loop.
- `watchFolder` rejects when the folder is missing: sleep and look again (30 s), do not spin.
  Writers rename a temporary file (`.name.tmp`) over the old one; skip those names and read
  only the files the watch reports.
- Skip a telemetry file with another `v`, one that does not parse, one whose `pid` is not
  running, and one without a `pid` that has not changed for six hours. Terminal ids are given
  out again: a file last written before its terminal was made is an earlier session's. A limit
  whose `resetsAt` has passed says nothing.
- `gh pr view <branch>` reads a branch named `123` as a pull request number; list by head.
- A linked worktree's repository name comes from the shared git folder, not from its own
  folder's name. Git before 2.31 prints `--path-format=absolute` back and answers with relative
  paths.
- `terminals()` can name parents in a loop; break it at a terminal on the loop.
- A plain `git status` takes the index lock to write the index back, and an agent's own git in
  that checkout then fails on the lock: ask with `--no-optional-locks`.
- Herdr's interface font draws no Nerd Font glyphs (they come out as boxes): the git marks are
  plain characters.
- A release outside the mod is not heard, so a drag can outlive its press: while a border is
  held, lay a sheet over the whole mod that takes the moves and the release, and let the next
  press on it end the drag without reaching a row. Do not end a drag from `on_hover`.
- A column must not be widened past what the name can give, or the narrow-block rule drops a
  column in the middle of the drag.
- Each machine reads on its own, so one that is slow or away holds up nobody else. A machine
  with no `ps -axo` (Windows, BusyBox) gets no CPU and memory.
- A mod folder that is a symlink is not reloaded on save; install a copy.
- Assumes `git` and, for pull requests, a signed-in `gh` on each machine; without them those
  columns stay empty and nothing else changes.

## Done when

- `herdr-app check` on the mod passes, and passes on copies forced into demo mode at 1400, 700,
  300, 200, 120 and 60px wide (`scripts/check-renders.sh`).
- `node --test` passes: the tree, the process sums, git labels and status, telemetry matching,
  the number formats, the color scale, the column order and widths, the demo data.
- With `--props '{"demo": true}'` it shows nine agents in three spaces, one of them on another
  machine, with every status, a three-level tree and all the telemetry columns.
- With real agents and no telemetry folder, every row has its status, tab, dir, git, branch,
  CPU and memory, and there is no model/effort, ctx, 7d, 5h or cost column.
- A file changed in an agent's checkout shows in its git cell within about ten seconds.
- Writing a telemetry file for a running agent adds its figures to that row within a second;
  removing it takes them away.
- Clicking a row goes to that agent's tab and pane; clicking its dir cell opens the folder in
  VS Code and does not go to the agent.
- Opened over the window, the marked row is the agent of the pane the person was in.
- A column dragged wider is as wide the next time the mod opens; a double-click on its border
  puts it back.
