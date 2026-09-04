import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const listStudioFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listStudio } = await import("./sync.server");
    return listStudio(context.userId);
  });

export const lookupHandleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { handle: string }) => input)
  .handler(async ({ data }) => {
    const { lookupHandle } = await import("./sync.server");
    return lookupHandle(data.handle);
  });

export const connectPublisherFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { handle: string; source?: string }) => input)
  .handler(async ({ context, data }) => {
    const { connectPublisher } = await import("./sync.server");
    return connectPublisher(context.userId, data.handle, data.source ?? "handle");
  });

export const removePublisherFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { publisherId: string }) => input)
  .handler(async ({ context, data }) => {
    const { removePublisher } = await import("./sync.server");
    await removePublisher(context.userId, data.publisherId);
    return { ok: true as const };
  });

export const addSourcesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { publisherId: string; handles: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { addSources } = await import("./sync.server");
    return addSources(context.userId, data.publisherId, data.handles);
  });

export const removeSourcesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { removeSources } = await import("./sync.server");
    await removeSources(context.userId, data.ids);
    return { ok: true as const };
  });

export const moveSourcesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[]; publisherId: string }) => input)
  .handler(async ({ context, data }) => {
    const { moveSources } = await import("./sync.server");
    await moveSources(context.userId, data.ids, data.publisherId);
    return { ok: true as const };
  });

export const listPostsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { sourceId: string; offset?: number; limit?: number; oldestFirst?: boolean }) => input)
  .handler(async ({ context, data }) => {
    const { listPosts } = await import("./sync.server");
    return listPosts(context.userId, data.sourceId, data.offset ?? 0, data.limit ?? 40, data.oldestFirst);
  });

export const exportPublisherFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { publisherId: string }) => input)
  .handler(async ({ context, data }) => {
    const { exportPublisher } = await import("./sync.server");
    return exportPublisher(context.userId, data.publisherId);
  });

export const tickSourceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { sourceId: string }) => input)
  .handler(async ({ context, data }) => {
    const { tickSource } = await import("./sync.server");
    return tickSource(context.userId, data.sourceId);
  });

export const retrySourceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { sourceId: string }) => input)
  .handler(async ({ context, data }) => {
    const { retrySource } = await import("./sync.server");
    return retrySource(context.userId, data.sourceId);
  });

export const tickDueFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { tickDueForUser } = await import("./sync.server");
    return tickDueForUser(context.userId, 2);
  });

export const listLiveFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { publisherId?: string | null }) => input)
  .handler(async ({ context, data }) => {
    const { listLive } = await import("./drip.server");
    return listLive(context.userId, data.publisherId ?? null);
  });

export const addWatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { handles: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { addWatchHandles } = await import("./drip.server");
    return addWatchHandles(context.userId, data.handles);
  });

export const removeWatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { removeWatchHandles } = await import("./drip.server");
    await removeWatchHandles(context.userId, data.ids);
    return { ok: true as const };
  });

export const setDripFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { publisherId: string; enabled: boolean }) => input)
  .handler(async ({ context, data }) => {
    const { setDripEnabled } = await import("./drip.server");
    await setDripEnabled(context.userId, data.publisherId, data.enabled);
    return { ok: true as const };
  });

export const markOutboxFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[]; status: "sent" | "skipped" }) => input)
  .handler(async ({ context, data }) => {
    const { markOutbox } = await import("./drip.server");
    await markOutbox(context.userId, data.ids, data.status);
    return { ok: true as const };
  });

export const tickLiveFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { tickLiveForUser } = await import("./drip.server");
    return tickLiveForUser(context.userId);
  });
