import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/agent/ids";
import { PACKS, PLANS, TOPUP, formatUsd } from "./catalog.ts";
import { COINS, DEFAULT_COIN, assertCoin } from "./coins.ts";
import { verifyFollowMembership } from "./follows.ts";
import {
  availableThreads,
  followIdsForUser,
  invoiceForUser,
  loadBilling,
  markInvoiceCancelled,
  markInvoiceOpened,
  markInvoiceUncertain,
  openInvoiceIntent,
  recordFollow,
  verifyDeskFollowsLive,
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

/** Client `followsVerified` is stripped. Membership is re-checked server-side. */
const CreateInvoiceSchema = z.object({
  skuId: z.string().trim().min(3).max(40),
  multiples: z.number().int().min(1).max(40).optional(),
  coinId: z.string().trim().min(2).max(40),
});

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
  .validator((d: unknown) => CreateInvoiceSchema.parse(d))
  .handler(async ({ context, data }): Promise<InvoicePublic> => {
    const coin = assertCoin(data.coinId);
    const origin = publicOrigin();
    if (!origin) throw new Error("BETTER_AUTH_URL is not set.");
    const invoiceId = newId("inv");
    const followsLive = await verifyDeskFollowsLive(context.userId);
    const quoted = await openInvoiceIntent({
      id: invoiceId,
      userId: context.userId,
      skuId: data.skuId,
      multiples: data.multiples ?? 1,
      payload: { coinId: coin.id },
      followsLive,
    });
    try {
      const created = await createPlisioInvoice({
        orderNumber: invoiceId,
        orderName: `${quoted.threads} threads`,
        amountCents: quoted.amountCents,
        coinId: coin.id,
        callbackUrl: `${origin}/api/payments/plisio?json=true`,
      });
      const expiresAt = created.expireUtc
        ? new Date(created.expireUtc * 1000)
        : new Date(Date.now() + 60 * 60 * 1000);
      const payload = {
        coinId: coin.id,
        walletHash: created.walletHash,
        qrCode: created.qrCode,
        amountCrypto: created.amountCrypto,
        invoiceUrl: created.invoiceUrl,
        txnId: created.txnId,
      };
      await markInvoiceOpened({
        id: invoiceId,
        userId: context.userId,
        externalId: created.txnId,
        payload,
        expiresAt,
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
    } catch (err) {
      const network =
        err instanceof TypeError ||
        (err instanceof Error && /fetch|network|abort|timeout/i.test(err.message));
      if (network) await markInvoiceUncertain(invoiceId, context.userId);
      else await markInvoiceCancelled(invoiceId, context.userId);
      throw err;
    }
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

const CheckFollowsSchema = z.object({
  telegramUserId: z.string().trim().min(1).max(80).optional(),
  discordUserId: z.string().trim().min(1).max(80).optional(),
});

export const checkFollows = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => CheckFollowsSchema.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<{ verified: boolean; telegram: boolean; discord: boolean }> => {
    const stored = await followIdsForUser(context.userId);
    const telegramUserId = data.telegramUserId || stored.telegram;
    const discordUserId = data.discordUserId || stored.discord;
    const result = await verifyFollowMembership({
      telegramUserId,
      discordUserId,
    });
    if (result.telegram && telegramUserId) {
      await recordFollow({
        userId: context.userId,
        network: "telegram",
        externalId: telegramUserId,
        verified: true,
      });
    }
    if (result.discord && discordUserId) {
      await recordFollow({
        userId: context.userId,
        network: "discord",
        externalId: discordUserId,
        verified: true,
      });
    }
    return result;
  });
