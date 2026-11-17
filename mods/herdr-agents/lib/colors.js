// Colors between the theme's own, and where on a green-to-red scale a value sits. No host calls.

/** "#rgb", "#rrggbb" or "#rrggbbaa" -> [red, green, blue, alpha], each 0..255; else null. */
export function parseHex(color) {
  const text = typeof color === "string" ? color.trim() : "";
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return [...short.slice(1).map((digit) => parseInt(digit + digit, 16)), 255];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(text);
  return long ? long.slice(1).map((pair) => (pair == null ? 255 : parseInt(pair, 16))) : null;
}

/**
 * The color `part` (0..1) of the way from `from` to `to`. A color written another way than
 * hex cannot be mixed: then the nearer of the two is the answer.
 */
export function mix(from, to, part) {
  const at = Math.max(0, Math.min(1, part));
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return at < 0.5 ? from : to;
  const channel = a.map((value, index) => Math.round(value + (b[index] - value) * at));
  const hex = channel.map((value) => value.toString(16).padStart(2, "0"));
  return `#${hex.slice(0, channel[3] === 255 ? 3 : 4).join("")}`;
}

/**
 * A level (0..1) as a color on `scale`, the theme's [green, yellow, red]: green at 0, yellow
 * at one half, red at 1, and the colors between them in between. No level, no color.
 */
export function heat(scale, level) {
  if (level == null) return null;
  const at = Math.max(0, Math.min(1, level));
  return at <= 0.5 ? mix(scale[0], scale[1], at * 2) : mix(scale[1], scale[2], (at - 0.5) * 2);
}

/** A percentage used (context, a limit) as a level: 0 is 0, 100 is 1. */
export function percentLevel(percent) {
  return percent == null ? null : Math.max(0, Math.min(1, percent / 100));
}

// A model's tier is one word of its name. Small and cheap is 0, the largest is 1.
const TIERS = [
  [["haiku", "mini", "nano"], 0],
  [["sonnet"], 0.25],
  [["opus"], 0.75],
  [["fable", "mythos", "max", "sol"], 1],
  [["gpt", "codex"], 0.5], // a Codex model with no size word: the plain one
];

/** How heavy a model is, 0..1, or null for a name that says nothing about it. */
export function modelLevel(model) {
  const words = new Set(String(model ?? "").toLowerCase().split(/[^a-z]+/));
  for (const [names, level] of TIERS) if (names.some((name) => words.has(name))) return level;
  return null;
}

const EFFORTS = { none: 0, minimal: 0, low: 0, medium: 0.25, high: 0.5, xhigh: 0.75, max: 1 };

/** How high an effort is, 0..1, or null for a word (or a number) this does not know. */
export function effortLevel(effort) {
  const word = String(effort ?? "").toLowerCase();
  return Object.hasOwn(EFFORTS, word) ? EFFORTS[word] : null;
}
