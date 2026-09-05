import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { DEV_USER_ID } from "@/lib/auth/verify.server";
import { telegramOidcConfig, telegramRedirectUri } from "@/lib/telegram/config.server";
import { errorQuery } from "@/lib/telegram/errors";
import { exchangeTelegramCode } from "@/lib/telegram/oidc";
import { consumeOidcTicket, upsertLinkedAccount } from "@/lib/telegram/snapshot.server";

function redirectTo(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

export const Route = createFileRoute("/api/telegram/oidc/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("error")) return redirectTo(errorQuery("telegram_denied"));

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return redirectTo(errorQuery("telegram_login_expired"));

        const session = await auth.api.getSession({ headers: request.headers });
        const userId = session?.user?.id ?? (process.env.VITE_AUTH_ENABLED === "false" ? DEV_USER_ID : null);
        if (!userId) return redirectTo("/telegram?error=unauthorized");

        const cfg = telegramOidcConfig();
        if (!cfg) return redirectTo(errorQuery("not_configured"));

        const ticket = await consumeOidcTicket(state);
        if (!ticket || ticket.userId !== userId) {
          return redirectTo(errorQuery("telegram_login_expired"));
        }

        try {
          const profile = await exchangeTelegramCode({
            cfg,
            code,
            redirectUri: telegramRedirectUri(request),
            verifier: ticket.verifier,
            nonce: ticket.nonce,
          });
          await upsertLinkedAccount({
            userId,
            telegramUserId: profile.telegramUserId,
            firstName: profile.firstName,
            lastName: profile.lastName,
            username: profile.username,
            photoUrl: profile.photoUrl,
            botCanWrite: profile.botCanWrite,
            path: "oidc",
            preview: false,
          });
          return redirectTo("/telegram/app");
        } catch (err) {
          const codeName =
            err && typeof err === "object" && "code" in err
              ? String((err as { code: string }).code)
              : "telegram_login_expired";
          console.info("[telegram]", { event: "oidc_callback_fail", code: codeName });
          if (codeName === "telegram_in_use") return redirectTo(errorQuery("telegram_in_use"));
          return redirectTo(errorQuery("telegram_login_expired"));
        }
      },
    },
  },
});
