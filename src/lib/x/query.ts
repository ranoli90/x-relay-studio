import type { SearchFilters } from "./types";

export function buildSearchQuery(base: string, flags: SearchFilters = {}): string {
  const parts: string[] = [];
  const trimmed = base.trim();
  if (trimmed) parts.push(trimmed);

  if (flags.from) parts.push(`from:${flags.from.replace(/^@/, "")}`);
  if (flags.since) parts.push(`since:${flags.since}`);
  if (flags.until) parts.push(`until:${flags.until}`);
  if (flags.lang) parts.push(`lang:${flags.lang}`);
  if (flags.minFaves !== undefined) parts.push(`min_faves:${flags.minFaves}`);
  if (flags.minRetweets !== undefined) parts.push(`min_retweets:${flags.minRetweets}`);

  for (const f of flags.filter ?? []) {
    const v = f.trim();
    if (!v) continue;
    parts.push(v.startsWith("-") ? `-filter:${v.slice(1)}` : `filter:${v}`);
  }

  return parts.join(" ");
}
