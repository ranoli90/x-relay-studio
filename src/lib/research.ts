import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { BriefResult, DraftResult, RelayResult, SearchFilters, SearchProduct } from "./x/types";

export const runRelayFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { q: string; product?: SearchProduct; filters?: SearchFilters }) => input)
  .handler(async ({ data }): Promise<RelayResult> => {
    const { runRelay } = await import("./x/search.server");
    return runRelay(data);
  });

export const runTrendsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: Record<string, never> = {}) => input)
  .handler(async (): Promise<RelayResult> => {
    const { runTrends } = await import("./x/search.server");
    return runTrends();
  });

export const runBriefFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      query: string;
      tweets: { handle: string; text: string; likes?: number; url: string }[];
    }) => input,
  )
  .handler(
    async ({ data }): Promise<{ ok: true; brief: BriefResult } | { ok: false; error: string }> => {
      const { runBrief } = await import("./x/search.server");
      return runBrief(data);
    },
  );

export const runDraftFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      kind: "post" | "reply" | "quote";
      instruction?: string;
      target?: { handle: string; text: string };
      context?: { handle: string; text: string }[];
    }) => input,
  )
  .handler(
    async ({ data }): Promise<{ ok: true; draft: DraftResult } | { ok: false; error: string }> => {
      const { runDraft } = await import("./x/search.server");
      return runDraft(data);
    },
  );

export const runProfilePostsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { handle: string }) => input)
  .handler(async ({ data }): Promise<RelayResult> => {
    const { runProfilePosts } = await import("./x/search.server");
    return runProfilePosts(data.handle);
  });

export const runThreadRepliesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<RelayResult> => {
    const { runThreadReplies } = await import("./x/search.server");
    return runThreadReplies(data.id);
  });
