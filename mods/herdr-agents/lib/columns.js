// The table's columns and their widths. No host calls.

/** The first column: the agent's name, with its tree lines, icon and title. */
export const NAME = { key: "name", label: "agent", width: 230, min: 120 };

/** The columns after the name, in display order. `right`: numbers, set against the right edge. */
export const COLUMNS = [
  { key: "status", label: "status", width: 82 },
  { key: "model", label: "model/effort", width: 124 },
  { key: "context", label: "ctx", width: 38, right: true },
  { key: "seven", label: "7d", width: 36, right: true },
  { key: "tab", label: "tab", width: 96 },
  { key: "dir", label: "dir", width: 150 },
  { key: "git", label: "git", width: 84 },
  { key: "branch", label: "branch", width: 136 },
  { key: "pr", label: "PR", width: 58 },
  { key: "cpu", label: "CPU", width: 44, right: true },
  { key: "mem", label: "mem", width: 44, right: true },
  { key: "five", label: "5h", width: 36, right: true },
  { key: "cost", label: "cost", width: 54, right: true },
];

/** The narrowest and the widest a person can make a column, in px. A column may name a `min` of its own. */
export const MIN_WIDTH = 28;
export const MAX_WIDTH = 800;

/** A width as whole px within the bounds. */
export const clampWidth = (width, min = MIN_WIDTH) => Math.max(min, Math.min(MAX_WIDTH, Math.round(width)));

/** Stored widths (JSON text, `{ key: px }`) -> the ones that name a column, within the bounds. */
export function parseWidths(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const widths = {};
  for (const { key, min } of [NAME, ...COLUMNS]) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) widths[key] = clampWidth(raw[key], min);
  return widths;
}

/** The columns with the widths a person gave them. */
export function sized(columns, widths) {
  return columns.map((column) => (widths?.[column.key] ? { ...column, width: widths[column.key] } : column));
}

/**
 * A column's width after the divider on its right edge was dragged `dx` px to the right. The
 * table holds to the left edge, so the divider stays under the pointer and the columns right
 * of it move along.
 */
export const dragged = (width, dx, min = MIN_WIDTH) => clampWidth(width + dx, min);

/** How wide the table is: the name, then each column after a gap. */
export const tableWidth = (name, columns, gap = 0) => columns.reduce((sum, column) => sum + gap + column.width, name);

/** Stored column keys (JSON text, a list) -> the ones that name a column. */
export function parseShown(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const known = new Set(COLUMNS.map((column) => column.key));
  return Array.isArray(raw) ? raw.filter((key) => known.has(key)) : [];
}

/**
 * Which columns are shown, in display order. `filled`: the keys some agent has something for;
 * a column nobody has anything for is left out. `remembered`: the keys shown the last time.
 * While `holding` (the mod has just opened and its readings are still coming in) those stay
 * too, empty, so that no column appears a moment later and pushes the others aside.
 */
export function shownKeys(filled, remembered, holding) {
  const keep = new Set(holding ? [...filled, ...remembered] : filled);
  return COLUMNS.filter((column) => keep.has(column.key)).map((column) => column.key);
}

/** A stored size (JSON text) -> { width, height }, or null. */
export function parseSize(text) {
  try {
    const size = JSON.parse(text);
    return size?.width > 0 && size?.height > 0 ? { width: size.width, height: size.height } : null;
  } catch {
    return null;
  }
}
