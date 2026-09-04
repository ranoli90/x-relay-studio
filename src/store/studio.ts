import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { chunk, parseHandles } from "@/lib/studio/handles";
import {
  addSourcesFn,
  connectPublisherFn,
  exportPublisherFn,
  listPostsFn,
  listStudioFn,
  moveSourcesFn,
  removePublisherFn,
  removeSourcesFn,
  retrySourceFn,
  tickSourceFn,
} from "@/lib/studio/fns";
import type { Publisher, SourceRow, StoredPost } from "@/lib/studio/types";

export type StudioTab = "sources" | "inspect";

type StudioState = {
  tab: StudioTab;
  publishers: Publisher[];
  sources: SourceRow[];
  selectedPublisherId: string | null;
  selectedSourceId: string | null;
  selectedIds: string[];
  filter: string;
  loading: boolean;
  adding: boolean;
  pumping: boolean;
  posts: StoredPost[];
  postsTotal: number;
  postsLoading: boolean;
  oldestFirst: boolean;
  setTab: (tab: StudioTab) => void;
  setFilter: (filter: string) => void;
  selectPublisher: (id: string | null) => void;
  selectSource: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  selectAllVisible: (ids: string[]) => void;
  clearSelected: () => void;
  refresh: () => Promise<void>;
  connect: (handle: string) => Promise<Publisher | null>;
  addHandles: (handles: string[] | string) => Promise<void>;
  removeSelected: () => Promise<void>;
  removePublisher: (id: string) => Promise<void>;
  moveSelected: (publisherId: string) => Promise<void>;
  loadPosts: (sourceId: string, offset?: number) => Promise<void>;
  setOldestFirst: (oldestFirst: boolean) => void;
  pump: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  exportActive: () => Promise<void>;
};

function isAuthError(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return err instanceof Error && /abort/i.test(err.message);
}

const CATCHUP_MS = 12 * 60 * 1000;
const ERROR_BACKOFF_MS = 2 * 60 * 1000;
const PUMP_BATCH = 2;

function isStale(iso: string | null, ms: number): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  return Number.isNaN(t) || Date.now() - t > ms;
}

function pickDue(sources: SourceRow[]): SourceRow | undefined {
  const hot = sources.find(
    (s) => s.status === "pending" || s.status === "syncing" || s.status === "rewriting",
  );
  if (hot) return hot;
  const errored = sources.find((s) => s.status === "error" && isStale(s.lastSyncedAt, ERROR_BACKOFF_MS));
  if (errored) return errored;
  return sources.find((s) => s.status === "ready" && isStale(s.lastSyncedAt, CATCHUP_MS));
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      tab: "sources",
      publishers: [],
      sources: [],
      selectedPublisherId: null,
      selectedSourceId: null,
      selectedIds: [],
      filter: "",
      loading: true,
      adding: false,
      pumping: false,
      posts: [],
      postsTotal: 0,
      postsLoading: false,
      oldestFirst: true,
      setTab: (tab) => set({ tab }),
      setFilter: (filter) => set({ filter }),
      selectPublisher: (id) =>
        set({
          selectedPublisherId: id,
          selectedSourceId: null,
          selectedIds: [],
          posts: [],
          postsTotal: 0,
        }),
      selectSource: (id) => set({ selectedSourceId: id, posts: [], postsTotal: 0 }),
      toggleSelected: (id) => {
        const selectedIds = get().selectedIds.includes(id)
          ? get().selectedIds.filter((x) => x !== id)
          : [...get().selectedIds, id];
        set({ selectedIds });
      },
      selectAllVisible: (ids) => set({ selectedIds: ids }),
      clearSelected: () => set({ selectedIds: [] }),
      refresh: async () => {
        try {
          const snap = await listStudioFn();
          const selectedPublisherId =
            get().selectedPublisherId && snap.publishers.some((p) => p.id === get().selectedPublisherId)
              ? get().selectedPublisherId
              : (snap.publishers[0]?.id ?? null);
          set({
            publishers: snap.publishers,
            sources: snap.sources,
            selectedPublisherId,
            loading: false,
          });
        } catch (err) {
          set({ loading: false });
          if (!isAuthError(err)) {
            toast.error(err instanceof Error ? err.message : "Could not load studio.");
          }
        }
      },
      connect: async (handle) => {
        try {
          const publisher = await connectPublisherFn({ data: { handle, source: "handle" } });
          await get().refresh();
          set({ selectedPublisherId: publisher.id });
          toast.success(`Posting as @${publisher.handle}`);
          return publisher;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not connect that account.");
          return null;
        }
      },
      addHandles: async (input) => {
        const publisherId = get().selectedPublisherId ?? get().publishers[0]?.id;
        if (!publisherId) {
          toast.error("Connect a posting account first.");
          return;
        }
        const handles = Array.isArray(input) ? input : parseHandles(input);
        if (!handles.length) {
          toast.error("Paste handles, profile URLs, or @names.");
          return;
        }
        set({ adding: true });
        try {
          let added = 0;
          const missing: string[] = [];
          const skipped: string[] = [];
          for (const group of chunk(handles, 12)) {
            const res = await addSourcesFn({ data: { publisherId, handles: group } });
            added += res.added.length;
            missing.push(...res.missing);
            skipped.push(...res.skipped);
          }
          await get().refresh();
          if (added) toast.success(`Assigned ${added} account${added === 1 ? "" : "s"}. Full archive queued.`);
          if (missing.length) toast.error(`Not found: ${missing.slice(0, 6).map((h) => `@${h}`).join(", ")}`);
          if (!added && skipped.length && !missing.length) toast.message("Those accounts are already assigned.");
          void get().pump();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not add accounts.");
        } finally {
          set({ adding: false });
        }
      },
      removeSelected: async () => {
        const ids = get().selectedIds;
        if (!ids.length) return;
        try {
          await removeSourcesFn({ data: { ids } });
          set({
            selectedIds: [],
            selectedSourceId: ids.includes(get().selectedSourceId ?? "") ? null : get().selectedSourceId,
          });
          await get().refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not remove.");
        }
      },
      removePublisher: async (id) => {
        try {
          await removePublisherFn({ data: { publisherId: id } });
          set({ selectedPublisherId: null, selectedSourceId: null, selectedIds: [] });
          await get().refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not remove posting account.");
        }
      },
      moveSelected: async (publisherId) => {
        const ids = get().selectedIds;
        if (!ids.length) return;
        try {
          await moveSourcesFn({ data: { ids, publisherId } });
          set({ selectedIds: [], selectedPublisherId: publisherId });
          await get().refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not move.");
        }
      },
      loadPosts: async (sourceId, offset = 0) => {
        set({ postsLoading: true });
        try {
          const res = await listPostsFn({
            data: { sourceId, offset, limit: 40, oldestFirst: get().oldestFirst },
          });
          set({
            posts: offset === 0 ? res.posts : [...get().posts, ...res.posts],
            postsTotal: res.total,
            postsLoading: false,
          });
        } catch (err) {
          set({ postsLoading: false });
          toast.error(err instanceof Error ? err.message : "Could not load posts.");
        }
      },
      setOldestFirst: (oldestFirst) => {
        set({ oldestFirst, posts: [], postsTotal: 0 });
        const sourceId = get().selectedSourceId;
        if (sourceId) void get().loadPosts(sourceId, 0);
      },
      pump: async () => {
        if (get().pumping) return;
        set({ pumping: true });
        try {
          let n = 0;
          while (n < PUMP_BATCH) {
            const next = pickDue(get().sources);
            if (!next) break;
            n += 1;
            try {
              const tick = await tickSourceFn({ data: { sourceId: next.id } });
              set({
                sources: get().sources.map((s) => (s.id === tick.source.id ? tick.source : s)),
              });
              if (get().selectedSourceId === tick.source.id && (tick.addedPosts > 0 || tick.rewrittenNow > 0)) {
                void get().loadPosts(tick.source.id, 0);
              }
            } catch (err) {
              if (isAbort(err)) break;
              const message = err instanceof Error ? err.message : "Sync failed.";
              set({
                sources: get().sources.map((s) =>
                  s.id === next.id
                    ? { ...s, status: "error", error: message, lastSyncedAt: new Date().toISOString() }
                    : s,
                ),
              });
            }
          }
        } finally {
          set({ pumping: false });
        }
      },
      retry: async (id) => {
        try {
          const source = await retrySourceFn({ data: { sourceId: id } });
          set({ sources: get().sources.map((s) => (s.id === id ? source : s)) });
          void get().pump();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Retry failed.");
        }
      },
      exportActive: async () => {
        const publisherId = get().selectedPublisherId;
        if (!publisherId) return;
        try {
          const data = await exportPublisherFn({ data: { publisherId } });
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-relay-${data.publisher.handle}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Export failed.");
        }
      },
    }),
    {
      name: "x-relay-studio-v1",
      partialize: (s) => ({
        selectedPublisherId: s.selectedPublisherId,
        tab: s.tab,
      }),
    },
  ),
);
