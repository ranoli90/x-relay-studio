import { createFileRoute } from "@tanstack/react-router";

function allowed(request: Request): boolean {
  if (request.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return false;
}

export const Route = createFileRoute("/api/cron/studio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!allowed(request)) {
          return new Response(JSON.stringify({ ok: false }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const { tickDueSources } = await import("@/lib/studio/sync.server");
        const result = await tickDueSources(4);
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
