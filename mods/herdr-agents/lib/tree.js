// Which terminals are agents, and how they nest. No host calls: plain data in, plain data out.

/** "vps/t7" -> { machine: "vps", id: "t7" }; "t7" -> { machine: null, id: "t7" }. */
export function splitAddress(address) {
  const text = String(address ?? "");
  const cut = text.lastIndexOf("/");
  return cut < 0 ? { machine: null, id: text } : { machine: text.slice(0, cut), id: text.slice(cut + 1) };
}

/** A live terminal Herdr calls an agent: it reports a status, or its program is a known agent. */
export function isAgent(terminal) {
  return terminal?.state === "live" && (terminal.status != null || terminal.program?.agent === true);
}

const WORDS = new Set(["working", "blocked", "done", "idle"]);

/**
 * The status a row shows. `listed` is Herdr's own word for an agent that has a pane (it knows
 * whether the person has looked). A terminal without a pane only has the core's raw word:
 * an error needs the person, and a finished turn is idle (it reports to its parent).
 */
export function rowStatus(terminal, listed) {
  if (WORDS.has(listed)) return listed;
  const raw = terminal?.status;
  if (raw === "error") return "blocked";
  if (raw === "done") return "idle";
  return WORDS.has(raw) ? raw : "unknown";
}

/**
 * Groups agent rows by space, children indented under their parent terminal.
 *
 * terminals: herdr `terminals()`; agents: herdr `agents()`; spaces: herdr `spaces()`;
 * folded: addresses whose children are hidden.
 * Returns { groups: [{ id, space, name, machine, rows }], rows } where a row is
 * { address, machine, id, terminal, listed, status, depth, guides, kids, folded, hidden, space, tab }.
 * `hidden` lists the statuses of the rows a folded row hides.
 * `guides` has one entry per level of depth: "pipe" | "space" for the ancestors' columns and
 * "tee" | "elbow" for the row's own.
 */
export function buildTree(terminals, agents = [], spaces = [], folded = new Set()) {
  const all = new Map();
  for (const terminal of terminals ?? []) if (terminal?.address) all.set(terminal.address, terminal);
  const listed = new Map((agents ?? []).map((agent, index) => [agent.address, { agent, index }]));
  const live = [...all.values()].filter(isAgent);
  const shown = new Set(live.map((terminal) => terminal.address));

  // The nearest ancestor that is itself a row: a plain program between two agents is skipped.
  const parentOf = (terminal) => {
    const seen = new Set([terminal.address]);
    let up = terminal.parent;
    while (up && !seen.has(up)) {
      if (shown.has(up)) return up;
      seen.add(up);
      up = all.get(up)?.parent;
    }
    return null;
  };

  const kids = new Map();
  const roots = [];
  for (const terminal of live) {
    const parent = parentOf(terminal);
    if (!parent) roots.push(terminal);
    else if (kids.has(parent)) kids.get(parent).push(terminal);
    else kids.set(parent, [terminal]);
  }
  const byAge = (a, b) => (a.created_ms ?? 0) - (b.created_ms ?? 0) || String(a.address).localeCompare(String(b.address));
  // Terminals that name each other as parent have no root above them. The oldest one on such a
  // loop becomes a root; what hangs off the loop stays under its parent.
  const reached = new Set();
  const reach = (terminal) => {
    if (reached.has(terminal.address)) return;
    reached.add(terminal.address);
    for (const kid of kids.get(terminal.address) ?? []) reach(kid);
  };
  roots.forEach(reach);
  for (const terminal of live) {
    if (reached.has(terminal.address)) continue;
    // Walk up until a terminal comes round again: from its first visit on, that is the loop.
    const path = [];
    let at = terminal;
    while (!path.includes(at)) {
      path.push(at);
      at = all.get(parentOf(at));
    }
    const root = path.slice(path.indexOf(at)).sort(byAge)[0];
    const beside = kids.get(parentOf(root));
    beside.splice(beside.indexOf(root), 1);
    roots.push(root);
    reach(root);
  }
  for (const list of kids.values()) list.sort(byAge);

  const spaceById = new Map((spaces ?? []).map((space, index) => [space.id, { ...space, position: index }]));
  const tabById = new Map((spaces ?? []).flatMap((space) => (space.tabs ?? []).map((tab) => [tab.id, tab])));

  // Where a terminal is shown: what Herdr lists for its pane, else the labels it was started
  // with. One with neither (a sub-agent without a pane) is where the terminal that started it is.
  const placeOf = (terminal) => {
    const seen = new Set();
    for (let at = terminal; at && !seen.has(at.address); at = all.get(at.parent)) {
      seen.add(at.address);
      const { machine } = splitAddress(at.address);
      const entry = listed.get(at.address)?.agent;
      const local = (id) => (id && machine && !String(id).includes("/") ? `${machine}/${id}` : id ?? null);
      const space = entry?.space ?? local(at.labels?.["herdr.space"]);
      if (!space) continue;
      const tabId = entry?.tab ?? local(at.labels?.["herdr.tab"]);
      const tab = entry ? { id: entry.tab, name: entry.tab_name, index: entry.tab_index } : tabById.has(tabId) ? { id: tabId, name: tabById.get(tabId).name, index: tabById.get(tabId).index } : null;
      return { space, tab };
    }
    return { space: null, tab: null };
  };

  const groups = new Map();
  const groupFor = (terminal) => {
    const { machine } = splitAddress(terminal.address);
    const { space } = placeOf(terminal);
    const known = spaceById.get(space);
    const id = known ? `space:${space}` : `machine:${machine ?? ""}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        space: known ? space : null,
        name: known ? known.name : listed.get(terminal.address)?.agent.space_name || (machine ?? ""),
        machine: known ? known.machine ?? null : machine,
        order: known ? known.position : Number.MAX_SAFE_INTEGER,
        rows: [],
      });
    }
    return groups.get(id);
  };

  const rootOrder = (a, b) => {
    const ia = listed.get(a.address)?.index ?? Number.MAX_SAFE_INTEGER;
    const ib = listed.get(b.address)?.index ?? Number.MAX_SAFE_INTEGER;
    return ia - ib || byAge(a, b);
  };

  const emit = (terminal, group, guides) => {
    const children = kids.get(terminal.address) ?? [];
    const closed = folded.has(terminal.address) && children.length > 0;
    const { machine, id } = splitAddress(terminal.address);
    const entry = listed.get(terminal.address)?.agent ?? null;
    const row = {
      address: terminal.address,
      machine,
      id,
      terminal,
      listed: entry,
      status: rowStatus(terminal, entry?.status),
      depth: guides.length,
      guides,
      kids: children.length,
      folded: closed,
      hidden: [],
      ...placeOf(terminal),
    };
    group.rows.push(row);
    if (closed) {
      const below = (address) => (kids.get(address) ?? []).flatMap((kid) => [rowStatus(kid, listed.get(kid.address)?.agent.status), ...below(kid.address)]);
      row.hidden = below(terminal.address);
      return;
    }
    // Under this row, its own column either carries on down (more siblings follow) or is empty.
    const carried = guides.map((guide) => (guide === "tee" || guide === "pipe" ? "pipe" : "space"));
    children.forEach((kid, index) => emit(kid, group, [...carried, index === children.length - 1 ? "elbow" : "tee"]));
  };

  for (const root of roots.sort(rootOrder)) emit(root, groupFor(root), []);
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order || String(a.machine ?? "").localeCompare(String(b.machine ?? "")));
  return { groups: ordered, rows: ordered.flatMap((group) => group.rows) };
}

/**
 * The terminals that have a pane of their own: the ones `panes()` shows, and the agents
 * `agents()` lists with one. A helper an agent started in the background (`hc run --bg`) is
 * in `terminals()` only.
 */
export function panedTerminals(panes, agents) {
  const paned = new Set();
  for (const pane of panes ?? []) if (pane?.terminal) paned.add(pane.terminal);
  for (const agent of agents ?? []) if (agent?.address && agent.pane) paned.add(agent.address);
  return paned;
}

/**
 * The command that takes the person to an agent. `agent.focus` goes to its pane; for a
 * terminal without one it answers ok and does nothing, so that one is peeked at over the tab.
 */
export function goCommand(address, paned) {
  return { name: paned.has(address) ? "agent.focus" : "terminal.peek", args: { terminal: address } };
}
