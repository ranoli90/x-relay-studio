import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BriefResult, RelayOk, SearchProduct, Tweet, UserProfile } from "@/lib/x/types";

export type SortMode = "engagement" | "newest";
export type Tab = "search" | "trends" | "archive";

type RelayState = {
  tab: Tab;
  query: string;
  product: SearchProduct;
  sort: SortMode;
  minFaves: number;
  loading: boolean;
  briefing: boolean;
  drafting: boolean;
  error: string | null;
  hint: string | null;
  result: RelayOk | null;
  brief: BriefResult | null;
  draft: string | null;
  archive: Tweet[];
  recent: string[];
  setTab: (tab: Tab) => void;
  setQuery: (q: string) => void;
  setProduct: (p: SearchProduct) => void;
  setSort: (s: SortMode) => void;
  setMinFaves: (n: number) => void;
  setLoading: (v: boolean) => void;
  setBriefing: (v: boolean) => void;
  setDrafting: (v: boolean) => void;
  setError: (error: string | null, hint?: string | null) => void;
  setResult: (result: RelayOk | null) => void;
  setBrief: (brief: BriefResult | null) => void;
  setDraft: (draft: string | null) => void;
  remember: (q: string) => void;
  saveTweet: (t: Tweet) => void;
  removeTweet: (id: string) => void;
  isSaved: (id: string) => boolean;
  clear: () => void;
};

export const useRelay = create<RelayState>()(
  persist(
    (set, get) => ({
      tab: "search",
      query: "",
      product: "Top",
      sort: "engagement",
      minFaves: 0,
      loading: false,
      briefing: false,
      drafting: false,
      error: null,
      hint: null,
      result: null,
      brief: null,
      draft: null,
      archive: [],
      recent: [],
      setTab: (tab) => set({ tab }),
      setQuery: (query) => set({ query }),
      setProduct: (product) => set({ product }),
      setSort: (sort) => set({ sort }),
      setMinFaves: (minFaves) => set({ minFaves }),
      setLoading: (loading) => set({ loading }),
      setBriefing: (briefing) => set({ briefing }),
      setDrafting: (drafting) => set({ drafting }),
      setError: (error, hint = null) => set({ error, hint }),
      setResult: (result) => set({ result, error: null, hint: null, brief: null, draft: null }),
      setBrief: (brief) => set({ brief }),
      setDraft: (draft) => set({ draft }),
      remember: (q) => {
        const trimmed = q.trim();
        if (!trimmed) return;
        const recent = [trimmed, ...get().recent.filter((x) => x !== trimmed)].slice(0, 8);
        set({ recent });
      },
      saveTweet: (t) => {
        if (get().archive.some((x) => x.id === t.id)) return;
        set({ archive: [t, ...get().archive].slice(0, 200) });
      },
      removeTweet: (id) => set({ archive: get().archive.filter((t) => t.id !== id) }),
      isSaved: (id) => get().archive.some((t) => t.id === id),
      clear: () => set({ result: null, brief: null, draft: null, error: null, hint: null }),
    }),
    {
      name: "x-relay-v1",
      partialize: (s) => ({
        archive: s.archive.slice(0, 80).map((t) => ({
          id: t.id,
          url: t.url,
          text: t.text,
          createdAt: t.createdAt,
          author: {
            id: t.author.id,
            handle: t.author.handle,
            name: t.author.name,
            verified: t.author.verified,
            avatar: t.author.avatar,
          },
          metrics: t.metrics,
          mediaItems: t.mediaItems?.map((m) => ({
            type: m.type,
            url: m.url,
            thumbnail: m.thumbnail,
          })),
          hydrated: true as const,
        })),
        recent: s.recent,
        product: s.product,
        sort: s.sort,
        minFaves: s.minFaves,
      }),
    },
  ),
);

export function tweetsFromResult(result: RelayOk | null): Tweet[] {
  if (!result) return [];
  if (result.kind === "search" || result.kind === "profile") return result.tweets;
  if (result.kind === "thread") return [result.thread.root, ...result.thread.replies];
  return [];
}

export function profilesFromResult(result: RelayOk | null): UserProfile[] {
  if (!result) return [];
  if (result.kind === "people") return result.users;
  if (result.kind === "profile") return [result.profile];
  return [];
}
