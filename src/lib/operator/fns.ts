import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { demoFixturesAllowed } from "@/lib/runtime";
import { parseCurrency } from "./money.ts";

export const loadOperatorDeskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { loadOperatorDesk } = await import("./persist.server");
    return loadOperatorDesk(context.userId);
  });

export const publishBusinessFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as {
      plainText?: string;
      offers?: Array<{ title?: string; amountMinor?: number; currency?: string; available?: boolean }>;
      paymentCopy?: string;
      destinationRef?: string;
    };
    const plainText = String(d.plainText ?? "").trim();
    if (!plainText) throw new Error("Write a short brief first.");
    const offers = (d.offers ?? [])
      .map((o) => ({
        title: String(o.title ?? "").trim(),
        amountMinor: Number(o.amountMinor),
        currency: parseCurrency(o.currency) ?? "",
        available: o.available !== false,
      }))
      .filter((o) => o.title && o.amountMinor > 0 && o.currency);
    if (offers.length === 0) throw new Error("Add at least one priced offer.");
    return {
      plainText,
      offers,
      paymentCopy: String(d.paymentCopy ?? "").trim(),
      destinationRef: String(d.destinationRef ?? "").trim(),
    };
  })
  .handler(async ({ context, data }) => {
    const { publishBusinessFromBrief } = await import("./persist.server");
    return publishBusinessFromBrief(context.userId, data);
  });

export const saveDraftFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string; body?: string };
    if (!d.conversationId) throw new Error("conversation required");
    return { conversationId: String(d.conversationId), body: String(d.body ?? "") };
  })
  .handler(async ({ context, data }) => {
    const { saveComposerDraft } = await import("./persist.server");
    await saveComposerDraft(context.userId, data.conversationId, data.body);
    return { ok: true };
  });

export const ackVisibleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as {
      conversationId?: string;
      conversationVisible?: boolean;
      documentVisible?: boolean;
      chatListOnly?: boolean;
    };
    if (!d.conversationId) throw new Error("conversation required");
    return {
      conversationId: String(d.conversationId),
      conversationVisible: Boolean(d.conversationVisible),
      documentVisible: d.documentVisible !== false,
      chatListOnly: Boolean(d.chatListOnly),
      explicitAck: true,
    };
  })
  .handler(async ({ context, data }) => {
    const { acknowledgeVisibleChat } = await import("./persist.server");
    const unread = await acknowledgeVisibleChat(context.userId, data.conversationId, data);
    return { unread };
  });

export const setProcessingPermissionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ on: Boolean((input as { on?: boolean }).on) }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql.query(
      `update agent_personas
          set processing_permission = $2,
              permission_revision = permission_revision + 1
        where user_id = $1`,
      [context.userId, data.on],
    );
    return { on: data.on };
  });

export const setEmergencyStopFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ on: Boolean((input as { on?: boolean }).on) }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql.query(
      `update agent_personas set emergency_stop = $2 where user_id = $1`,
      [context.userId, data.on],
    );
    await sql.query(
      `update telegram_user_sessions set emergency_stop = $2 where user_id = $1`,
      [context.userId, data.on],
    ).catch(() => undefined);
    if (data.on) {
      await sql.query(
        `update agent_personas set auto_send = false, automation_mode = 'draft' where user_id = $1`,
        [context.userId],
      );
    }
    return { on: data.on };
  });

export const setTakeoverFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string; on?: boolean };
    if (!d.conversationId) throw new Error("conversation required");
    return { conversationId: String(d.conversationId), on: Boolean(d.on) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql.query(
      `update agent_threads set takeover = $3 where user_id = $1 and (id = $2 or telegram_account_id = $2)`,
      [context.userId, data.conversationId, data.on],
    ).catch(() => undefined);
    await sql.query(
      `update telegram_chats set muted = $3 where user_id = $1 and id = $2`,
      [context.userId, data.conversationId, data.on],
    ).catch(() => undefined);
    return { on: data.on };
  });

export const setPartnerOptOutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string; on?: boolean };
    if (!d.conversationId) throw new Error("conversation required");
    return { conversationId: String(d.conversationId), on: Boolean(d.on) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql.query(
      `update agent_threads
          set opt_out = $3, opt_out_at = case when $3 then now() else null end,
              consent_epoch = consent_epoch + 1
        where user_id = $1 and (id = $2 or telegram_account_id = $2)`,
      [context.userId, data.conversationId, data.on],
    ).catch(() => undefined);
    return { on: data.on };
  });

export const proposeMediaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string; assetId?: string };
    if (!d.conversationId || !d.assetId) throw new Error("asset and conversation required");
    return { conversationId: String(d.conversationId), assetId: String(d.assetId) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { newOperatorId } = await import("./ids");
    const { canProposeAsset } = await import("./media");
    const sql = await getSql();
    const assets = await sql.query<{
      id: string;
      approval: string;
      title: string;
    }>(
      `select id, approval, title from media_assets where id = $1 and user_id = $2`,
      [data.assetId, context.userId],
    );
    const asset = assets[0];
    const gate = canProposeAsset(
      asset
        ? {
            id: asset.id,
            ownerUserId: context.userId,
            bindingId: "",
            kind: "image",
            title: asset.title,
            mime: "image/jpeg",
            byteSize: 1,
            storageKey: "",
            approval: asset.approval as "pending" | "approved" | "revoked",
            provesLiveHuman: false,
          }
        : null,
    );
    if (!gate.ok) return { ok: false as const, reason: gate.reason, status: gate.reason };
    const id = newOperatorId("prop");
    await sql.query(
      `insert into media_proposals (id, user_id, conversation_id, asset_id, status)
       values ($1,$2,$3,$4,'approved_not_sent')`,
      [id, context.userId, data.conversationId, data.assetId],
    );
    return { ok: true as const, id, status: "approved_not_sent" };
  });

export const evaluateEvidenceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as {
      offerId?: string;
      amountMinor?: number;
      currency?: string;
      destinationId?: string;
    };
    return {
      offerId: String(d.offerId ?? ""),
      amountMinor: Number(d.amountMinor),
      currency: String(d.currency ?? ""),
      destinationId: String(d.destinationId ?? ""),
    };
  })
  .handler(async ({ context, data }) => {
    const { recordPaymentEvidence } = await import("./persist.server");
    return recordPaymentEvidence(context.userId, data);
  });

export const labAllowedFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ allowed: demoFixturesAllowed() }));
