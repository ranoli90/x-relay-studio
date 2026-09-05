import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { DEV_USER_ID } from "@/lib/auth/verify.server";

export const Route = createFileRoute("/api/telegram/photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const peer = url.searchParams.get("p")?.trim() ?? "";
        if (!peer || peer.length > 40 || !/^[0-9-]+$/.test(peer)) {
          return new Response(null, { status: 404 });
        }
        const session = await auth.api.getSession({ headers: request.headers });
        const userId =
          session?.user?.id ?? (process.env.VITE_AUTH_ENABLED === "false" ? DEV_USER_ID : null);
        if (!userId) return new Response(null, { status: 401 });
        const { getPeerPhoto } = await import("@/lib/telegram/snapshot.server");
        const photo = await getPeerPhoto(userId, peer);
        if (!photo) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(photo.bytes), {
          headers: {
            "content-type": photo.mime || "image/jpeg",
            "cache-control": "private, max-age=86400",
          },
        });
      },
    },
  },
});
