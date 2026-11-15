# herdr-agents

A mod for [Herdr.app](https://herdr.dev): every agent terminal as one row, on every machine
Herdr knows. It works by itself, and shows more when
[agent-telemetry](https://github.com/evgenyt1/agent-telemetry) files are present.

## What it shows

One row for each terminal Herdr calls an agent (Claude Code, Codex, pi, any program that
reports a status), sub-agents indented under the agent that started them, grouped by space.

Always:

| Column | What |
| --- | --- |
| agent | The terminal's name and title, with the program's icon. |
| status | working, needs you, done or idle, in Herdr's own colors. |
| tab | The tab it is in; a sub-agent without a pane of its own is in its parent's tab. The space is named too when the row is listed under another space. |
| folder | The repository, then the worktree and the folder below it. Outside a repository, the path. |
| branch | The git branch there; `@abc1234` when a commit is checked out. |
| PR | The branch's pull request: open, draft (muted) or merged (`✓`). Click it to open it. |
| CPU, mem | Of the agent's process and everything it started. CPU is the load over the last 20 seconds or so (a minute on Linux, where `ps` counts CPU time in whole seconds), 100% being one core. |

With agent-telemetry, for each terminal a file matches:

| Column | What |
| --- | --- |
| model, effort | The model of the last request and its reasoning effort. |
| ctx | How full the context is: green under 50%, yellow under 80%, red from there. |
| 5h, 7d | How much of the five-hour and seven-day limits is used. |
| cost | What the session has cost so far. |

A column nobody has anything for is left out, so without telemetry files there are no telemetry
columns. In a narrow block the least important columns go first; under 520 px each agent takes
two lines; under 110 px only the status dots stay.

Click a row, or press Enter on it, to go to that agent. Arrows or `j` / `k` move, Left and
Right fold and unfold an agent's sub-agents. A folded agent says how many it hides, in the
color of the most urgent one, and they stay in the counts at the top.

## Install

Needs Herdr.app. `git` and `gh` are used when they are there.

```sh
git clone https://github.com/evgenyt1/herdr-agents
cd herdr-agents
./install.sh
```

This copies `mods/herdr-agents` into Herdr.app's folder (`$HERDR_APP_HOME`, else
`~/.config/herdr-app`). Run it again after `git pull`. `./install.sh --uninstall` takes it out.

The mod does not place itself anywhere, so your layout stays as it is. Show it where you like:

```sh
# Over the window; the same command closes it.
herdr-app do mod.open --name herdr-agents

# As a tab, or beside the focused pane.
herdr-app do tab.new --name agents --mod herdr-agents
herdr-app do pane.split --direction right --mod herdr-agents
```

For a key, add to `keys.json`: `"global": { "ctrl-shift-a": "mod.open:herdr-agents" }`.

To have it in place of Herdr's agents list, duplicate the layout and point the block at it:
`herdr-app do layout.clone '{"name":"main","as":"mine"}'`, then in `layouts/mine.json` change
the `agents` block's content to `{ "mod": "herdr-agents" }`.

## Telemetry

Optional. The mod reads the files that agent-telemetry's plugins keep, one per live session,
from `$AGENT_TELEMETRY_DIR`, else `$XDG_CACHE_HOME/agent-telemetry`, else
`~/.cache/agent-telemetry`. A file belongs to the terminal named in its `terminal.hc`, else to
the terminal whose program has its `pid` (or started it). Files of another format version,
temporary files and files of a process that is no longer running are skipped; a file that
names no process counts until it has gone six hours without a change. Terminal ids are given
out again, so a file last written before its terminal was made is taken for an earlier
session's. A limit whose window has reset since the file was written is not shown. The folder is
watched, not polled, so a change shows within a second. While the folder does not exist, it is
looked for every 30 seconds.

## Other machines

Agents on machines added to Herdr (`hc machine ls`) are listed too. Their processes, git state
and telemetry folder are read on that machine, every 15 to 30 seconds.

## Settings

Props, where a layout or a command gives them (`--props '{"refresh": 10}'`):

| Prop | Default | What |
| --- | --- | --- |
| `refresh` | `5` | Seconds between readings (2 at least). CPU and memory are read every time, git no more often than every 10 seconds. |
| `telemetryDir` | from the environment | The telemetry folder on this machine. |
| `order` | `true`, over the window `false` | Whether `agent.next` / `agent.prev` follow this list's order (the whole tree, folded or not). `false` leaves it to another mod. |
| `stay` | `false` | Opened over the window: stay open after going to an agent. |
| `background` | `chrome`, over the window `popover` | A theme color name for the background. |
| `demo` | `false` | Show made-up agents instead of yours. |

## What it runs

In the background, never while drawing: `ps` every 5 seconds, `git` every 10 seconds for each
folder an agent is in, and `gh pr list --head <branch>` for each branch every 2 minutes (5 when
it has no pull request). It only reads. What it has read is kept while Herdr runs, so opening the mod again
shows branches and pull requests at once. Where there is no `ps` that takes `-axo` (Windows,
BusyBox), CPU and memory stay empty.

## Working on it

```sh
node --test                           # tree building, telemetry, ps and git parsing
herdr-app check mods/herdr-agents     # the mod loads and renders (with no agents)
./scripts/check-renders.sh            # the same with the demo's rows, at four widths
./install.sh                          # then look at it in Herdr
```

`./install.sh --link` links the checkout instead of copying it; Herdr does not reload a linked
mod on save, so reopen it after an edit. The logic without Herdr in it is in
`mods/herdr-agents/lib`, with tests in `test/`.

## License

MIT
