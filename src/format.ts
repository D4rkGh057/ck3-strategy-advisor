// `/date` parses to a JS Date (unquoted in real saves); format to CK3 "Y.M.D".
// Fall back to a quote-stripped string if a save ever stores it as a string.
export function formatCk3Date(v: unknown): string {
  if (v instanceof Date) return `${v.getUTCFullYear()}.${v.getUTCMonth() + 1}.${v.getUTCDate()}`;
  return (typeof v === "string" ? v : String(v ?? "")).replace(/"/g, "");
}

export function stamp(snapshot: { date: string; parsedAt: number }, body: string): string {
  const ageMin = Math.round((Date.now() - snapshot.parsedAt) / 60000);
  const age = ageMin <= 0 ? "just now" : `${ageMin} min ago`;
  return `_Snapshot: ${snapshot.date} (read ${age})_\n\n${body}`;
}
export function truncate<T>(items: T[], n: number): { shown: T[]; note: string } {
  if (items.length <= n) return { shown: items, note: "" };
  return { shown: items.slice(0, n), note: `\n\n_Showing ${n} of ${items.length}._` };
}

/**
 * Formatting rule: a formatter returns one entry (one or several lines) WITHOUT a trailing newline.
 * `bullet` prefixes a list entry; `block` stacks entries one per line and closes the last one, so
 * the caller never has to remember who ends with a newline. An empty list gives "".
 */
export const bullet = (text: string): string => `- ${text}`;

export function block(entries: string[]): string {
  return entries.length ? entries.join("\n") + "\n" : "";
}
