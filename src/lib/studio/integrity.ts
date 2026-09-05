import {
  openRouterEnabled,
  studioTickEnabled,
  unofficialXLookupEnabled,
  xAutoPostEnabled,
} from "../flags.ts";
import type { MediaItem } from "../x/types.ts";
import type { OutboxStatus, SourceStatus } from "./types.ts";

export const MAX_AHEAD = 8;
export const ORIGINAL_GAP_MIN = 150;
export const REPLY_GAP_MIN = 60;
export const QUOTE_GAP_MIN = 180;

export type StudioTickNeed = {
  openRouter?: boolean;
  xLookup?: boolean;
};

export type StudioTickGate =
  | { ok: true }
  | { ok: false; reason: "studio" | "openrouter" | "x-lookup" | "autopost" };

/** Kill/hold flags that studio tick paths must honor before any external caller. */
export function studioTickGate(need: StudioTickNeed = {}): StudioTickGate {
  if (!studioTickEnabled()) return { ok: false, reason: "studio" };
  if (need.openRouter && !openRouterEnabled()) return { ok: false, reason: "openrouter" };
  if (need.xLookup && !unofficialXLookupEnabled()) return { ok: false, reason: "x-lookup" };
  return { ok: true };
}

/** Hard invariant: ticks must never take an X write path. */
export function assertManualQueueOnly(): void {
  if (xAutoPostEnabled()) {
    throw new Error("X auto-post is forbidden. Outbox is a manual queue.");
  }
}

export function mapOutboxStatus(raw: string): OutboxStatus {
  if (raw === "sent" || raw === "skipped") return raw;
  return "due";
}

export type ArchiveScopeInput = {
  tweetsClaimed: number;
  tweetsSynced: number;
  backfillDone: boolean;
  status: string;
};

export function archiveScope(input: ArchiveScopeInput): "complete" | "partial" {
  if (!input.backfillDone) return "partial";
  if (input.status === "syncing" || input.status === "pending" || input.status === "error") {
    return "partial";
  }
  if (input.tweetsClaimed > 0 && input.tweetsSynced < input.tweetsClaimed) return "partial";
  return "complete";
}

export function archiveIsPartial(input: ArchiveScopeInput): boolean {
  return archiveScope(input) === "partial";
}

export function sourceArchivePartial(source: {
  tweetsClaimed: number;
  tweetsSynced: number;
  backfillDone: boolean;
  status: SourceStatus | string;
}): boolean {
  return archiveIsPartial(source);
}

/**
 * Attach a photo only when it belongs to this post. Never fall back to
 * another post's media, a token-matched neighbor, or a random pool pick.
 */
export function pickOwnPhoto(media: MediaItem[] | null | undefined): string | null {
  if (!Array.isArray(media)) return null;
  for (const item of media) {
    if (!item || item.type !== "photo") continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

export function parseMediaJson(raw: unknown): MediaItem[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      return parseMediaJson(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: MediaItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { type?: unknown; url?: unknown; thumbnail?: unknown };
    const url = typeof rec.url === "string" ? rec.url : "";
    if (!url) continue;
    const typeRaw = String(rec.type ?? "photo");
    const type = typeRaw === "video" ? "video" : typeRaw === "gif" || typeRaw === "animated_gif" ? "gif" : "photo";
    out.push(
      typeof rec.thumbnail === "string" && rec.thumbnail
        ? { type, url, thumbnail: rec.thumbnail }
        : { type, url },
    );
  }
  return out;
}

export function nextDue(lastIso: string | null | undefined, gapMin: number, nowMs = Date.now()): string {
  const gap = gapMin * 60 * 1000;
  const last = lastIso ? Date.parse(lastIso) : 0;
  const minStart = Number.isFinite(last) ? last + gap : nowMs;
  return new Date(Math.max(nowMs, minStart)).toISOString();
}

export type FairRow = { user_id: string };

/** Round-robin across tenants so one desk cannot starve the rest of a tick. */
export function fairSelect<T extends FairRow>(rows: T[], limit: number): T[] {
  const cap = Math.max(0, limit);
  if (!cap || !rows.length) return [];
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.user_id || "";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(row);
  }
  const out: T[] = [];
  let depth = 0;
  while (out.length < cap) {
    let added = false;
    for (const user of order) {
      const bucket = buckets.get(user);
      const row = bucket?.[depth];
      if (!row) continue;
      out.push(row);
      added = true;
      if (out.length >= cap) break;
    }
    if (!added) break;
    depth += 1;
  }
  return out;
}
