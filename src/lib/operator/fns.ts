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
      voice?: string;
      boundaries?: string;
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
      voice: String(d.voice ?? "").trim(),
      boundaries: String(d.boundaries ?? "").trim(),
    };
  })
  .handler(async ({ context, data }) => {
    const { publishBusinessFromBrief } = await import("./persist.server");
    return publishBusinessFromBrief(context.userId, data);
  });

export const saveDraftFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string; body?: string; version?: number };
    if (!d.conversationId) throw new Error("conversation required");
    return {
      conversationId: String(d.conversationId),
      body: String(d.body ?? ""),
      version: typeof d.version === "number" ? d.version : undefined,
    };
  })
  .handler(async ({ context, data }) => {
    const { saveComposerDraft } = await import("./persist.server");
    return saveComposerDraft(context.userId, data.conversationId, data.body, data.version);
  });

export const ackVisibleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as {
      conversationId?: string;
      conversationVisible?: boolean;
      documentVisible?: boolean;
      chatListOnly?: boolean;
      lastSeenMessageId?: string;
    };
    if (!d.conversationId) throw new Error("conversation required");
    return {
      conversationId: String(d.conversationId),
      conversationVisible: Boolean(d.conversationVisible),
      documentVisible: d.documentVisible !== false,
      chatListOnly: Boolean(d.chatListOnly),
      explicitAck: true,
      lastSeenMessageId: d.lastSeenMessageId ? String(d.lastSeenMessageId) : null,
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
    );
    if (data.on) {
      await sql.query(
        `update agent_personas set auto_send = false, automation_mode = 'draft' where user_id = $1`,
        [context.userId],
      );
    } else {
      const { applyLiveArm } = await import("@/lib/agent/seed.server");
      await applyLiveArm(context.userId);
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
    const { withTransaction } = await import("@/lib/db");
    await withTransaction(async (sql) => {
      const updated = await sql.query<{ id: string }>(
        `update agent_threads
            set takeover = $3
          where user_id = $1
            and (
              id = $2
              or telegram_account_id = $2
              or fan_id in (select id from agent_fans where user_id = $1 and tg_peer_id = $2)
            )
         returning id`,
        [context.userId, data.conversationId, data.on],
      );
      if (!updated[0]) throw new Error("conversation not found");
      await sql.query(
        `update telegram_chats set muted = $3 where user_id = $1 and id = $2`,
        [context.userId, data.conversationId, data.on],
      );
      return updated;
    });
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
    const rows = await sql.query<{ id: string }>(
      `update agent_threads
          set opt_out = $3, opt_out_at = case when $3 then now() else null end,
              consent_epoch = consent_epoch + 1
        where user_id = $1
          and (
            id = $2
            or telegram_account_id = $2
            or fan_id in (select id from agent_fans where user_id = $1 and tg_peer_id = $2)
          )
        returning id`,
      [context.userId, data.conversationId, data.on],
    );
    if (!rows[0]) throw new Error("conversation not found");
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

export const loadConversationControlsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string };
    if (!d.conversationId) throw new Error("conversation required");
    return { conversationId: String(d.conversationId) };
  })
  .handler(async ({ context, data }) => {
    const { loadConversationControls } = await import("./persist.server");
    return loadConversationControls(context.userId, data.conversationId);
  });

export const labAllowedFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ allowed: demoFixturesAllowed() }));

export const setAdultEligibilityFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { conversationId?: string; status?: string; evidence?: string };
    if (!d.conversationId) throw new Error("conversation required");
    const status: "allowed" | "unknown" | "disallowed" =
      d.status === "allowed" || d.status === "disallowed" ? d.status : "unknown";
    return { conversationId: String(d.conversationId), status, evidence: String(d.evidence ?? "") };
  })
  .handler(async ({ context, data }) => {
    const { setAdultEligibility } = await import("./persist.server");
    return setAdultEligibility(context.userId, data.conversationId, data.status, data.evidence);
  });

export const uploadMediaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { title?: string; mime?: string; bytesBase64?: string };
    const mime = String(d.mime ?? "");
    const raw = String(d.bytesBase64 ?? "");
    if (!raw) throw new Error("file required");
    return { title: String(d.title ?? "Still"), mime, bytesBase64: raw };
  })
  .handler(async ({ context, data }) => {
    const { uploadMediaAsset } = await import("./persist.server");
    const bytes = Buffer.from(data.bytesBase64, "base64");
    return uploadMediaAsset(context.userId, { title: data.title, mime: data.mime, bytes });
  });

export const setMediaApprovalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { assetId?: string; approval?: string };
    if (!d.assetId) throw new Error("asset required");
    const approval = d.approval === "revoked" ? "revoked" : "approved";
    return { assetId: String(d.assetId), approval: approval as "approved" | "revoked" };
  })
  .handler(async ({ context, data }) => {
    const { setMediaApproval } = await import("./persist.server");
    return setMediaApproval(context.userId, data.assetId, data.approval);
  });

export const sendMediaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const d = input as { proposalId?: string };
    if (!d.proposalId) throw new Error("proposal required");
    return { proposalId: String(d.proposalId) };
  })
  .handler(async ({ context, data }) => {
    const { sendMediaProposal } = await import("./persist.server");
    return sendMediaProposal(context.userId, data.proposalId);
  });

