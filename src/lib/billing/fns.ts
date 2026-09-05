import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/agent/ids";
import { PACKS, PLANS, TOPUP, formatUsd } from "./catalog.ts";
import { COINS, DEFAULT_COIN, assertCoin } from "./coins.ts";
import { bothFollowsLive } from "./follows.ts";
import {
  availableThreads,
  invoiceForUser,
  insertOpenInvoice,
  loadBilling,
  quoteForUser,
} from "./ledger.server.ts";
import { createPlisioInvoice, publicOrigin } from "./plisio.ts";

export type WalletPublic = {
  threads: number;
  firstPayment: boolean;
  followDiscountUsed: boolean;
  followDiscountAvailable: boolean;
  packs: { id: string; label: string; threads: number; priceLabel: string }[];
  plans: { id: string; label: string; threads: number; priceLabel: string; personas: number }[];
  topup: { id: string; label: string; threads: number; priceLabel: string };
  coins: { id: string; ticker: string; label: string; network: string }[];
  defaultCoin: string;
  telegramUrl: string | null;
  discordUrl: string | null;
};

export type InvoicePublic = {
  id: string;
  status: string;
  threads: number;
  amountCents: number;
  amountLabel: string;
  discountCents: number;
  coinId: string;
  coinLabel: string;
  walletHash: string | null;
  qrCode: string | null;
  amountCrypto: string | null;
  invoiceUrl: string | null;
  expiresAt: string | null;
};

function followUrls() {
  return {
    telegramUrl: process.env.FOLLOW_TELEGRAM_URL?.trim() || null,
    discordUrl: process.env.FOLLOW_DISCORD_URL?.trim() || null,
  };
}

export const getWallet = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WalletPublic> => {
    const billing = await loadBilling(context.userId);
    const threads = await availableThreads(context.userId);
    const urls = followUrls();
    return {
      threads,
      firstPayment: !billing.first_paid_at,
      followDiscountUsed: billing.follow_discount_used,
      followDiscountAvailable: !billing.first_paid_at && !billing.follow_discount_used,
      packs: PACKS.map((p) => ({
        id: p.id,
        label: p.label,
        threads: p.threads,
        priceLabel: formatUsd(p.priceCents),
      })),
      plans: PLANS.map((p) => ({
        id: p.id,
        label: p.label,
        threads: p.threads,
        priceLabel: formatUsd(p.priceCents),
        personas: p.personas,
      })),
      topup: {
        id: TOPUP.id,
        label: TOPUP.label,
        threads: TOPUP.threads,
        priceLabel: formatUsd(TOPUP.priceCents),
      },
      coins: COINS.map((c) => ({ id: c.id, ticker: c.ticker, label: c.label, network: c.network })),
      defaultCoin: DEFAULT_COIN,
      ...urls,
    };
  });

export const createThreadInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { skuId: string; multiples?: number; coinId: string; followsVerified?: boolean }) => d)
  .handler(async ({ context, data }): Promise<InvoicePublic> => {
    const coin = assertCoin(data.coinId);
    const followsVerified = Boolean(data.followsVerified);
    const quoted = await quoteForUser(
      context.userId,
      data.skuId,
      data.multiples ?? 1,
      followsVerified,
    );
    const origin = publicOrigin();
    if (!origin) throw new Error("BETTER_AUTH_URL is not set.");
    const invoiceId = newId("inv");
    const created = await createPlisioInvoice({
      orderNumber: invoiceId,
      orderName: `${quoted.threads} threads`,
      amountCents: quoted.amountCents,
      coinId: coin.id,
      callbackUrl: `${origin}/api/payments/plisio?json=true`,
    });
    const expiresAt = created.expireUtc ? new Date(created.expireUtc * 1000) : new Date(Date.now() + 60 * 60 * 1000);
    await insertOpenInvoice({
      id: invoiceId,
      userId: context.userId,
      quoted,
      externalId: created.txnId,
      expiresAt,
      payload: {
        coinId: coin.id,
        walletHash: created.walletHash,
        qrCode: created.qrCode,
        amountCrypto: created.amountCrypto,
        invoiceUrl: created.invoiceUrl,
        txnId: created.txnId,
      },
    });
    return {
      id: invoiceId,
      status: "pending",
      threads: quoted.threads,
      amountCents: quoted.amountCents,
      amountLabel: formatUsd(quoted.amountCents),
      discountCents: quoted.discountCents,
      coinId: coin.id,
      coinLabel: `${coin.ticker} · ${coin.network}`,
      walletHash: created.walletHash,
      qrCode: created.qrCode,
      amountCrypto: created.amountCrypto,
      invoiceUrl: created.invoiceUrl,
      expiresAt: expiresAt.toISOString(),
    };
  });

export const pollInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { invoiceId: string }) => d)
  .handler(async ({ context, data }): Promise<InvoicePublic> => {
    const row = await invoiceForUser(context.userId, data.invoiceId);
    if (!row) throw new Error("Invoice not found.");
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const coinId = typeof payload.coinId === "string" ? payload.coinId : DEFAULT_COIN;
    const coin = assertCoin(coinId);
    return {
      id: row.id,
      status: row.status,
      threads: row.threads,
      amountCents: row.amount_cents,
      amountLabel: formatUsd(row.amount_cents),
      discountCents: row.discount_cents,
      coinId: coin.id,
      coinLabel: `${coin.ticker} · ${coin.network}`,
      walletHash: typeof payload.walletHash === "string" ? payload.walletHash : null,
      qrCode: typeof payload.qrCode === "string" ? payload.qrCode : null,
      amountCrypto: typeof payload.amountCrypto === "string" ? payload.amountCrypto : null,
      invoiceUrl: typeof payload.invoiceUrl === "string" ? payload.invoiceUrl : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
    };
  });

export const checkFollows = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { telegramUserId?: string; discordUserId?: string }) => d)
  .handler(async ({ data }): Promise<{ verified: boolean; telegram: boolean; discord: boolean }> => {
    const chatId = process.env.FOLLOW_TELEGRAM_CHAT_ID?.trim();
    const bot = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const guildId = process.env.FOLLOW_DISCORD_GUILD_ID?.trim();
    const discordToken = process.env.DISCORD_BOT_TOKEN?.trim();

    let telegram = false;
    if (chatId && bot && data.telegramUserId) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${bot}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(data.telegramUserId)}`,
        );
        const body = (await res.json()) as { ok?: boolean; result?: { status?: string } };
        telegram = Boolean(body.ok && body.result?.status);
        telegram = bothFollowsLive({
          telegramStatus: body.result?.status ?? null,
          discordGuilds: [],
          requiredGuildId: "skip",
        })
          ? telegramMemberOnly(body.result?.status ?? null)
          : telegramMemberOnly(body.result?.status ?? null);
      } catch {
        telegram = false;
      }
    }

    let discord = false;
    if (guildId && discordToken && data.discordUserId) {
      try {
        const res = await fetch(
          `https://discord.com/api/v10/guilds/${guildId}/members/${data.discordUserId}`,
          { headers: { authorization: `Bot ${discordToken}` } },
        );
        discord = res.ok;
      } catch {
        discord = false;
      }
    }

    return { verified: telegram && discord, telegram, discord };
  });

function telegramMemberOnly(status: string | null): boolean {
  return status === "member" || status === "administrator" || status === "creator";
}
