// Numbers as short column text. No host calls.

/** CPU percent of one core: "0%", "3.2%", "145%". */
export function cpuText(percent) {
  if (percent == null) return "";
  const tenths = Math.round(percent * 10) / 10;
  if (tenths === 0) return "0%";
  return tenths < 10 ? `${tenths.toFixed(1)}%` : `${Math.round(percent)}%`;
}

/** Memory from KiB: "84M", "1.3G". */
export function memText(kib) {
  if (kib == null) return "";
  const mib = kib / 1024;
  if (mib < 999.5) return `${Math.round(mib)}M`;
  const gib = mib / 1024;
  return gib < 10 ? `${gib.toFixed(1)}G` : `${Math.round(gib)}G`;
}

/** Dollars: "$0.42", "$4.12", "$118". */
export function costText(usd) {
  if (usd == null) return "";
  return usd < 99.995 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`;
}

/** A percentage as a whole number: "7%". */
export function percentText(percent) {
  return percent == null ? "" : `${Math.round(percent)}%`;
}

/**
 * Which columns fit. `columns`: [{ key, width, rank }] in display order; `rank` 1 is dropped
 * last. Returns the keys that fit in `room` px (with `gap` px between columns), in display order.
 */
export function fitColumns(columns, room, gap = 0) {
  const kept = new Set();
  let used = 0;
  for (const column of [...columns].sort((a, b) => a.rank - b.rank)) {
    const need = column.width + (kept.size ? gap : 0);
    if (used + need > room) break;
    used += need;
    kept.add(column.key);
  }
  return columns.filter((column) => kept.has(column.key)).map((column) => column.key);
}
