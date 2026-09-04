import type { MediaItem, Metrics } from "@/lib/x/types";

export type SourceStatus = "pending" | "syncing" | "rewriting" | "ready" | "error";

export type VoiceBrief = {
  voice: string;
  topics: string[];
  bio: string;
  pinned: string;
};

export type PublisherKit = {
  bio: string;
  pinned: string;
};

export type Publisher = {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  source: string;
  kit: PublisherKit | null;
  createdAt: string;
  dripEnabled: boolean;
};

export type WatchHandle = {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  enabled: boolean;
  lastSeenAt: string | null;
};

export type OutboxKind = "original" | "reply";
export type OutboxStatus = "due" | "sent" | "skipped";

export type OutboxItem = {
  id: string;
  publisherId: string;
  kind: OutboxKind;
  status: OutboxStatus;
  body: string;
  mediaUrl: string | null;
  replyToUrl: string | null;
  dueAt: string;
  sentAt: string | null;
};

export type LiveSnapshot = {
  watch: WatchHandle[];
  outbox: OutboxItem[];
  dueCount: number;
  sentToday: number;
};

export type SourceRow = {
  id: string;
  publisherId: string;
  handle: string;
  name: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  followers: number;
  tweetsClaimed: number;
  tweetsSynced: number;
  mediaSynced: number;
  rewritten: number;
  rewritePending: number;
  rewriteSkipped: number;
  status: SourceStatus;
  stage: string | null;
  error: string | null;
  voice: VoiceBrief | null;
  lastSyncedAt: string | null;
  backfillDone: boolean;
  windowsRun: number;
};

export type StoredPost = {
  id: string;
  sourceId: string;
  tweetId: string;
  url: string | null;
  text: string;
  createdAt: string | null;
  metrics: Metrics;
  media: MediaItem[];
  isReply: boolean;
  isRetweet: boolean;
  isQuote: boolean;
  rewriteText: string | null;
  rewriteStatus: "pending" | "done" | "skipped";
};

export type StudioSnapshot = {
  publishers: Publisher[];
  sources: SourceRow[];
};

export type LookupProfile = {
  handle: string;
  name: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  followers: number;
  tweets: number;
  verified: boolean;
};

export type AddSourcesResult = {
  added: SourceRow[];
  skipped: string[];
  missing: string[];
};

export type TickResult = {
  source: SourceRow;
  addedPosts: number;
  rewrittenNow: number;
  done: boolean;
};
