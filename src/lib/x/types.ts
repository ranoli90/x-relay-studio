export type SearchProduct = "Top" | "Latest" | "Media" | "People";

export type Author = {
  id: string;
  handle: string;
  name: string;
  verified: boolean;
  followers?: number;
  following?: number;
  avatar?: string;
};

export type Metrics = {
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  views?: number;
};

export type MediaKind = "photo" | "video" | "gif";

export type MediaItem = {
  type: MediaKind;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
};

export type Tweet = {
  id: string;
  url: string;
  text: string;
  lang?: string;
  createdAt?: string;
  author: Author;
  metrics: Metrics;
  hashtags?: string[];
  mentions?: string[];
  media?: MediaKind[];
  mediaItems?: MediaItem[];
  isReply?: boolean;
  isRetweet?: boolean;
  isQuote?: boolean;
  conversationId?: string;
  quoted?: Tweet;
  hydrated?: boolean;
};

export type UserProfile = {
  id: string;
  handle: string;
  name: string;
  bio?: string;
  verified: boolean;
  followers: number;
  following: number;
  tweets: number;
  createdAt?: string;
  location?: string;
  avatar?: string;
  banner?: string;
  url: string;
};

export type ThreadResult = {
  root: Tweet;
  replies: Tweet[];
  returnedCount: number;
  claimedCount?: number;
  truncated: boolean;
  warning?: string;
};

export type Trend = {
  name: string;
  rank?: number;
  volume?: string;
  context?: string;
};

export type SearchFilters = {
  from?: string;
  since?: string;
  until?: string;
  lang?: string;
  minFaves?: number;
  minRetweets?: number;
  filter?: string[];
};

export type BriefResult = {
  headline: string;
  summary: string;
  takeaways: string[];
  notable?: string[];
};

export type DraftResult = {
  text: string;
  kind: "post" | "reply" | "quote";
};

export type RelayOk =
  | {
      ok: true;
      kind: "search";
      query: string;
      product: SearchProduct;
      tweets: Tweet[];
      note?: string;
      live: boolean;
    }
  | {
      ok: true;
      kind: "profile";
      profile: UserProfile;
      tweets: Tweet[];
      note?: string;
      live: boolean;
    }
  | {
      ok: true;
      kind: "thread";
      thread: ThreadResult;
      live: boolean;
    }
  | {
      ok: true;
      kind: "people";
      query: string;
      users: UserProfile[];
      note?: string;
      live: boolean;
    }
  | {
      ok: true;
      kind: "trends";
      trends: Trend[];
      note?: string;
      live: boolean;
    };

export type RelayErr = {
  ok: false;
  error: string;
  hint?: string;
};

export type RelayResult = RelayOk | RelayErr;
