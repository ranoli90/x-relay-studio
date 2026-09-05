import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { cronJobsEnabled } from "@/lib/flags";

function allowed(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/cron/studio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!allowed(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        if (!cronJobsEnabled()) {
          return new Response(JSON.stringify({ ok: true, skipped: "flag" }), {
            headers: { "content-type": "application/json" },
          });
        }
        const { withCronLock } = await import("@/lib/jobs/lock");
        const { tickDueSources } = await import("@/lib/studio/sync.server");
        const { tickLiveAll } = await import("@/lib/studio/tick-live.server");
        const { ensureAgentLoop, tickAutoSendOnce } = await import("@/lib/agent/loop.server");
        ensureAgentLoop();
        const lease = await withCronLock(async () => {
          const scrape = await tickDueSources(6);
          const live = await tickLiveAll(4);
          const auto = await tickAutoSendOnce();
          return { scrape, live, auto };
        });
        if (!lease.ran) {
          return new Response(JSON.stringify({ ok: true, skipped: "lock" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            ok: true,
            scrape: lease.result?.scrape ?? null,
            live: lease.result?.live ?? null,
            queued: lease.result?.auto?.drained ?? 0,
            jobs: lease.result?.auto?.jobs ?? 0,
            watch: lease.result?.auto?.watch ?? 0,
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
