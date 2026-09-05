export const REDDIT_SCOPES = ["identity", "read", "privatemessages"].join(" ");

export const APP_VERSION = "v1.0.0";
export const APP_ID = "reddit-relay";

export function userAgentFor(redditUsername: string) {
  const handle = redditUsername.replace(/^u\//, "").trim() || "unknown";
  return `web:${APP_ID}:${APP_VERSION} (by /u/${handle})`;
}

export type HealthStatus = "pass" | "fail" | "warn" | "unknown";
export type HealthSeverity = "hard" | "soft" | "info";

export type HealthCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  severity: HealthSeverity;
  detail: string;
  fix?: string;
};

export type HealthReport = {
  okToUse: boolean;
  postingLocked: true;
  checks: HealthCheck[];
  ranAt: string;
};

export type RedditAppPublic = {
  configured: boolean;
  clientId?: string;
  userAgentName?: string;
  redirectUri: string;
};

export type RedditAccountPublic = {
  id: string;
  redditId: string;
  name: string;
  iconImg: string | null;
  createdUtc: number | null;
  hasVerifiedEmail: boolean;
  isGold: boolean;
  isMod: boolean;
  isSuspended: boolean;
  linkKarma: number;
  commentKarma: number;
  totalKarma: number;
  healthOk: boolean;
  health: HealthReport | null;
  onboardedAt: string | null;
};

export type RedditMessage = {
  id: string;
  fullname: string;
  kind: "message" | "comment";
  author: string;
  dest: string;
  subject: string;
  body: string;
  createdUtc: number;
  isNew: boolean;
  wasComment: boolean;
  threadId: string;
  subreddit: string | null;
  context: string | null;
};

export type RedditThread = {
  id: string;
  subject: string;
  participants: string[];
  latestUtc: number;
  unread: number;
  wasComment: boolean;
  subreddit: string | null;
  messages: RedditMessage[];
};

export type InboxSnapshot = {
  threads: RedditThread[];
  unreadCount: number;
  fetchedAt: string;
  truncated: boolean;
};
