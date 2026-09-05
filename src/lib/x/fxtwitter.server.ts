import { unofficialXLookupEnabled } from "@/lib/flags";
import type { Author, MediaItem, MediaKind, Tweet, UserProfile } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

type CacheEntry<T> = { at: number; value: T };
const tweetCache = new Map<string, CacheEntry<Tweet>>();
const profileCache = new Map<string, CacheEntry<UserProfile>>();
const TTL_MS = 90_000;

function fromCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

async function getJson(url: string, timeoutMs = 5_000): Promise<unknown> {
  if (!unofficialXLookupEnabled()) {
    throw new Error("Unofficial X lookup is disabled. Set FXTWITTER_ENABLED=true to use the public FXTwitter mirror.");
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function biggerAvatar(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace("_normal.", "_bigger.").replace("_mini.", "_bigger.");
}

function mapAuthor(raw: Record<string, unknown> | null): Author {
  const verification = asRecord(raw?.verification);
  return {
    id: String(raw?.id ?? raw?.rest_id ?? ""),
    handle: String(raw?.screen_name ?? raw?.handle ?? "unknown"),
    name: String(raw?.name ?? raw?.screen_name ?? "Unknown"),
    verified:
      asBool(raw?.verified) ||
      asBool(verification?.verified) ||
      Boolean(verification?.type),
    followers: asNumber(raw?.followers ?? raw?.followers_count),
    following: asNumber(raw?.following ?? raw?.following_count),
    avatar: biggerAvatar(asString(raw?.avatar_url ?? raw?.profile_image_url)),
  };
}

function mapMedia(raw: unknown): MediaItem[] {
  const rec = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rec?.all)
      ? rec!.all
      : Array.isArray(rec?.photos)
        ? [...(rec!.photos as unknown[]), ...((rec!.videos as unknown[]) ?? [])]
        : [];
  const items: MediaItem[] = [];
  for (const item of list) {
    const m = asRecord(item);
    if (!m) continue;
    const typeRaw = String(m.type ?? "photo");
    const type: MediaKind =
      typeRaw === "video" ? "video" : typeRaw === "gif" || typeRaw === "animated_gif" ? "gif" : "photo";
    const url = asString(m.url ?? m.media_url_https);
    if (!url) continue;
    items.push({
      type,
      url,
      thumbnail: asString(m.thumbnail_url ?? m.preview_image_url ?? m.thumbnail),
      width: asNumber(m.width),
      height: asNumber(m.height),
    });
  }
  return items;
}

export function mapFxTweet(rawUnknown: unknown): Tweet | null {
  const raw = asRecord(rawUnknown);
  if (!raw) return null;
  const tweet = asRecord(raw.tweet) ?? raw;
  const id = asString(tweet.id) ?? asString(tweet.rest_id);
  if (!id) return null;
  const authorRaw = asRecord(tweet.author) ?? asRecord(tweet.user);
  const author = mapAuthor(authorRaw);
  const handle = author.handle || "i";
  const mediaItems = mapMedia(tweet.media);
  const quotedRaw = tweet.quote ?? tweet.quoted_tweet ?? tweet.quoted;
  const quoted = quotedRaw ? mapFxTweet(quotedRaw) : undefined;
  const created =
    asString(tweet.created_at) ??
    (asNumber(tweet.created_timestamp)
      ? new Date(asNumber(tweet.created_timestamp)! * 1000).toISOString()
      : undefined);

  return {
    id,
    url: asString(tweet.url) ?? `https://x.com/${handle}/status/${id}`,
    text: asString(tweet.text) ?? asString(tweet.full_text) ?? "",
    lang: asString(tweet.lang),
    createdAt: created,
    author,
    metrics: {
      likes: asNumber(tweet.likes ?? tweet.favorite_count),
      retweets: asNumber(tweet.retweets ?? tweet.retweet_count),
      replies: asNumber(tweet.replies ?? tweet.reply_count),
      quotes: asNumber(tweet.quotes ?? tweet.quote_count),
      bookmarks: asNumber(tweet.bookmarks ?? tweet.bookmark_count),
      views: asNumber(tweet.views ?? tweet.view_count),
    },
    media: mediaItems.map((m) => m.type),
    mediaItems: mediaItems.length ? mediaItems : undefined,
    isReply: Boolean(tweet.replying_to || tweet.replying_to_status || tweet.in_reply_to_status_id),
    isQuote: Boolean(quoted),
    quoted: quoted ?? undefined,
    hydrated: true,
  };
}

export function mapFxUser(rawUnknown: unknown): UserProfile | null {
  const raw = asRecord(rawUnknown);
  if (!raw) return null;
  const user = asRecord(raw.user) ?? raw;
  const handle = asString(user.screen_name) ?? asString(user.handle);
  if (!handle) return null;
  const verification = asRecord(user.verification);
  const website = asRecord(user.website);
  return {
    id: String(user.id ?? ""),
    handle,
    name: asString(user.name) ?? handle,
    bio: asString(user.description) ?? asString(website?.display),
    verified:
      asBool(user.verified) || asBool(verification?.verified) || Boolean(verification?.type),
    followers: asNumber(user.followers ?? user.followers_count) ?? 0,
    following: asNumber(user.following ?? user.following_count) ?? 0,
    tweets: asNumber(user.tweets ?? user.statuses_count) ?? 0,
    createdAt: asString(user.joined ?? user.created_at),
    location: asString(user.location),
    avatar: biggerAvatar(asString(user.avatar_url ?? user.profile_image_url)),
    banner: asString(user.banner_url ?? user.profile_banner_url),
    url: asString(user.url) ?? `https://x.com/${handle}`,
  };
}

export async function fetchTweet(id: string): Promise<Tweet | null> {
  if (!unofficialXLookupEnabled()) return null;
  const cached = fromCache(tweetCache, id);
  if (cached) return cached;
  try {
    const data = await getJson(`https://api.fxtwitter.com/status/${encodeURIComponent(id)}`);
    const tweet = mapFxTweet(data);
    if (tweet) tweetCache.set(id, { at: Date.now(), value: tweet });
    return tweet;
  } catch {
    return null;
  }
}

export async function fetchProfile(handle: string): Promise<UserProfile | null> {
  if (!unofficialXLookupEnabled()) return null;
  const key = handle.replace(/^@/, "").toLowerCase();
  const cached = fromCache(profileCache, key);
  if (cached) return cached;
  try {
    const data = await getJson(`https://api.fxtwitter.com/${encodeURIComponent(key)}`);
    const profile = mapFxUser(data);
    if (profile) profileCache.set(key, { at: Date.now(), value: profile });
    return profile;
  } catch {
    return null;
  }
}

export async function hydrateTweets(partial: Tweet[], limit = 12): Promise<Tweet[]> {
  if (!unofficialXLookupEnabled()) return partial.slice(0, limit);
  const slice = partial.slice(0, limit);
  const out = slice.slice();
  const pending: number[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const t = slice[i];
    if (t.hydrated && (t.mediaItems?.length || t.author.avatar)) continue;
    if (t.mediaItems && t.mediaItems.length > 0 && t.text) continue;
    pending.push(i);
  }
  const CONCURRENCY = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const i = pending[cursor];
      cursor += 1;
      const live = await fetchTweet(slice[i].id);
      if (!live) continue;
      out[i] = {
        ...live,
        text: live.text || slice[i].text,
        metrics: { ...slice[i].metrics, ...live.metrics },
        mediaItems: live.mediaItems?.length ? live.mediaItems : slice[i].mediaItems,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  return out;
}

export async function hydrateProfiles(handles: string[], limit = 12): Promise<UserProfile[]> {
  if (!unofficialXLookupEnabled()) return [];
  const unique = [...new Set(handles.map((h) => h.replace(/^@/, "")).filter(Boolean))].slice(0, limit);
  const results = await Promise.all(unique.map((h) => fetchProfile(h)));
  return results.filter((p): p is UserProfile => p !== null);
}
