import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

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
        const userId = session?.user?.id ?? null;
        if (!userId) return new Response(null, { status: 401 });
        const { getPeerPhoto } = await import("@/lib/telegram/snapshot.server");
        const photo = await getPeerPhoto(userId, peer);
        if (!photo) return new Response(null, { status: 404 });
        const mime = photo.mime === "image/png" || photo.mime === "image/webp" ? photo.mime : "image/jpeg";
        return new Response(new Uint8Array(photo.bytes), {
          headers: {
            "content-type": mime,
            "x-content-type-options": "nosniff",
            "cache-control": "private, max-age=86400",
            "content-disposition": "inline",
          },
        });
      },
    },
  },
});
