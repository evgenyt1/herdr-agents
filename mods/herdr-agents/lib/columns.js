// The table's columns and their widths. No host calls.

/**
 * Table columns in display order, after the agent's name. `rank`: 1 is given up last when the
 * block is narrow. `right`: numbers, set against the right edge.
 */
export const COLUMNS = [
  { key: "status", label: "status", width: 82, rank: 1 },
  { key: "model", label: "model/effort", width: 124, rank: 2 },
  { key: "context", label: "ctx", width: 38, rank: 3, right: true },
  { key: "seven", label: "7d", width: 36, rank: 4, right: true },
  { key: "tab", label: "tab", width: 96, rank: 11 },
  { key: "dir", label: "dir", width: 150, rank: 6 },
  { key: "git", label: "git", width: 84, rank: 7 },
  { key: "branch", label: "branch", width: 136, rank: 5 },
  { key: "pr", label: "PR", width: 58, rank: 8 },
  { key: "cpu", label: "CPU", width: 44, rank: 9, right: true },
  { key: "mem", label: "mem", width: 44, rank: 10, right: true },
  { key: "five", label: "5h", width: 36, rank: 13, right: true },
  { key: "cost", label: "cost", width: 54, rank: 12, right: true },
];

/** The narrowest and the widest a person can make a column, in px. */
export const MIN_WIDTH = 28;
export const MAX_WIDTH = 480;

/** A width as whole px within the bounds. */
export const clampWidth = (width) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));

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
  for (const { key } of COLUMNS) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) widths[key] = clampWidth(raw[key]);
  return widths;
}

/** The columns with the widths a person gave them. */
export function sized(columns, widths) {
  return columns.map((column) => (widths?.[column.key] ? { ...column, width: widths[column.key] } : column));
}

/**
 * A column's width after its left border was dragged `dx` px to the right. The columns hold to
 * the right edge of the table, so the border follows the pointer and the name takes the rest.
 */
export const dragged = (width, dx) => clampWidth(width - dx);
