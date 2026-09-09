import { getSql, withTransaction, type Sql } from "@/lib/db";
import { demoFixturesAllowed } from "@/lib/runtime";
import type { CatalogRow } from "@/lib/agent/types.ts";
import { parseAutomationMode } from "@/lib/conversation/policy.ts";
import { newOperatorId } from "./ids.ts";
import { isolatedFixtureSet } from "./fixtures.ts";
import { cloneFinalState, type FinalState } from "./state.ts";
import { shouldMarkRead, type ReadAckInput } from "./unread.ts";
import {
  canPublish,
  draftFromBrief,
  planningCatalog,
  serviceKeyFromTitle,
  type PublishedProjection,
  type StructuredBusiness,
} from "./business.ts";

import { evaluatePaymentEvidence, publicPaymentView } from "./payments.ts";
import { money } from "./money.ts";
import { effectiveAutoReply, type AutoReplyView } from "./effective-state.ts";
import { healthIsReady, type GenerationHealth } from "@/lib/conversation/generate.ts";
import { OPERATOR_ERASE_TABLES } from "./erase.ts";
import { quoteFromOffer, quoteView, type QuoteView } from "./quotes.ts";

function isUniqueViolation(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const msg = err instanceof Error ? err.message : "";
  return code === "23505" || /unique|duplicate/i.test(msg);
}

function colBool(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  return v === true || v === "t" || v === "true" || v === 1;
}

function colInt(row: Record<string, unknown>, key: string, fallback = 0): number {
  const v = row[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function emptyStructured(): StructuredBusiness {
  return {
    displayName: "",
    about: "",
    voice: "",
    boundaries: "",
    offers: [],
    paymentCopy: "",
    destinationHint: "",
    reviewQuestions: [],
    sourceBrief: "",
  };
}

function parseStructured(raw: string): StructuredBusiness {
  const parsed = JSON.parse(raw) as Partial<StructuredBusiness>;
  return {
    ...emptyStructured(),
    ...parsed,
    offers: Array.isArray(parsed.offers) ? parsed.offers : [],
    reviewQuestions: Array.isArray(parsed.reviewQuestions) ? parsed.reviewQuestions : [],
  };
}

export async function loadLiveFinalState(
  userId: string,
  threadId?: string | null,
): Promise<FinalState> {
  const sql = await getSql();
  const personas = await sql.query<Record<string, unknown>>(
    `select automation_mode, emergency_stop, auto_send, permission_revision, processing_permission,
            profile_revision, desired_auto_reply, writer_last_ok, writer_last_at
       from agent_personas where user_id = $1 limit 1`,
    [userId],
  );
  const persona = personas[0] ?? {};
  let thread: Record<string, unknown> = {};
  if (threadId) {
    const rows = await sql.query<Record<string, unknown>>(
      `select takeover, opt_out, consent_epoch, account_generation, telegram_account_id
         from agent_threads where id = $1 and user_id = $2 limit 1`,
      [threadId, userId],
    );
    thread = rows[0] ?? {};
  }
  const sessions = await sql.query<Record<string, unknown>>(
    `select emergency_stop, account_generation, watching, auth_dead, session_enc
       from telegram_user_sessions where user_id = $1 limit 1`,
    [userId],
  );
  const session = sessions[0] ?? {};
  const published = await sql.query<{ revision: number }>(
    `select revision from business_revisions
      where user_id = $1 and status = 'published'
        and ($2::boolean or isolated = false)
      order by revision desc limit 1`,
    [userId, demoFixturesAllowed()],
  );

  const emergencyStop = colBool(persona, "emergency_stop") || colBool(session, "emergency_stop");
  const accountLive = Boolean(session.session_enc) && !colBool(session, "auth_dead");
  const processingPermission = colBool(persona, "processing_permission");
  return {
    accountGeneration: colInt(thread, "account_generation", colInt(session, "account_generation", 1)),
    consentEpoch: colInt(thread, "consent_epoch", 1),
    permissionRevision: colInt(persona, "permission_revision", 1),
    businessRevision: published[0]?.revision ?? null,
    emergencyStop,
    takeover: colBool(thread, "takeover"),
    optOut: colBool(thread, "opt_out"),
    automationMode: parseAutomationMode(persona.automation_mode),
    processingPermission,
    conversationPermitted: processingPermission && !colBool(thread, "opt_out"),
    accountLive,
    assetApprovalOk: true,
  };
}

export async function loadPublishedProjection(
  userId: string,
  opts?: { allowIsolated?: boolean; bindingId?: string },
): Promise<PublishedProjection | null> {
  const sql = await getSql();
  const allowIsolated = Boolean(opts?.allowIsolated ?? demoFixturesAllowed());
  const revs = await sql.query<{
    id: string;
    binding_id: string;
    revision: number;
    structured_json: string;
    isolated: boolean;
  }>(
    `select r.id, r.binding_id, r.revision, r.structured_json, coalesce(r.isolated, false) as isolated
       from business_revisions r
      where r.user_id = $1 and r.status = 'published'
        and ($2::boolean or r.isolated = false)
        and ($3::text is null or r.binding_id = $3)
      order by r.revision desc limit 1`,
    [userId, allowIsolated, opts?.bindingId ?? null],
  );
  const rev = revs[0];
  if (!rev) return null;
  const structured = parseStructured(rev.structured_json);
  const offers = await sql.query<{
    id: string;
    binding_id: string;
    revision_id: string;
    service_key: string | null;
    title: string;
    amount_minor: number;
    currency: string;
    available: boolean;
    status: string;
    description: string | null;
  }>(
    `select id, binding_id, revision_id, service_key, title, amount_minor, currency, available, status, description
       from business_offers
      where user_id = $1 and revision_id = $2`,
    [userId, rev.id],
  );
  const binds = await sql.query<{ creator_id: string }>(
    `select creator_id from operator_bindings where id = $1 and user_id = $2`,
    [rev.binding_id, userId],
  );
  const creatorId = binds[0]?.creator_id ?? userId;
  return {
    revisionId: rev.id,
    revision: rev.revision,
    creatorId,
    bindingId: rev.binding_id,
    displayName: structured.displayName,
    about: structured.about,
    isolated: Boolean(rev.isolated),
    paymentCopy: structured.paymentCopy,
    destinationHint: structured.destinationHint ?? "",
    boundaries: structured.boundaries ?? "",
    offers: offers.map((o) => ({
      id: o.id,
      serviceKey: o.service_key || o.id,
      creatorId,
      bindingId: o.binding_id,
      revisionId: o.revision_id,
      title: o.title,
      amount: money(Number(o.amount_minor), o.currency),
      available: o.available,
      status: o.status as "draft" | "approved" | "published" | "unavailable",
      description: o.description ?? "",
    })),
  };
}

export async function catalogForPlanning(
  userId: string,
  _fallback: CatalogRow[] = [],
  published?: PublishedProjection | null,
): Promise<CatalogRow[]> {
  void _fallback;
  const proj = published === undefined ? await loadPublishedProjection(userId) : published;
  const sql = await getSql();
  const dest = proj
    ? await sql.query<{ provider: string; destination_ref: string }>(
        `select provider, destination_ref from payment_destinations
          where user_id = $1 and binding_id = $2
            and revoked_at is null
            and (revision_id is null or revision_id = $3)
          order by created_at desc limit 1`,
        [userId, proj.bindingId, proj.revisionId],
      )
    : [];
  const handle = dest[0]?.destination_ref?.trim() || proj?.destinationHint?.trim() || "";
  const rail = handle && handle !== "manual_handle" ? handle : "";

  return planningCatalog(proj, rail).map((r) => ({
    id: r.id,
    sku: r.sku,
    title: r.title,
    priceCents: r.priceCents,
    rail: r.rail,
    eligibility: r.eligibility,
    currency: r.currency,
  }));
}

export async function ensureBinding(userId: string): Promise<{ id: string; creatorId: string }> {
  const sql = await getSql();
  const existing = await sql.query<{ id: string; creator_id: string }>(
    `select id, creator_id from operator_bindings where user_id = $1 limit 1`,
    [userId],
  );
  if (existing[0]) return { id: existing[0].id, creatorId: existing[0].creator_id };
  const id = newOperatorId("bind");
  const creatorId = `creator_${userId.slice(0, 12)}`;
  await sql.query(
    `insert into operator_bindings (id, user_id, telegram_account_id, creator_id)
     values ($1,$2,$3,$4)
     on conflict (user_id, telegram_account_id) do nothing`,
    [id, userId, userId, creatorId],
  );
  const again = await sql.query<{ id: string; creator_id: string }>(
    `select id, creator_id from operator_bindings where user_id = $1 limit 1`,
    [userId],
  );
  if (!again[0]) throw new Error("binding_failed");
  return { id: again[0].id, creatorId: again[0].creator_id };
}

export async function saveComposerDraft(userId: string, conversationId: string, body: string): Promise<void> {
  const sql = await getSql();
  if (!body.trim()) {
    await sql.query(
      `delete from composer_drafts where user_id = $1 and conversation_id = $2`,
      [userId, conversationId],
    );
    return;
  }
  await sql.query(
    `insert into composer_drafts (user_id, conversation_id, body, updated_at)
     values ($1,$2,$3, now())
     on conflict (user_id, conversation_id)
     do update set body = excluded.body, updated_at = now(), version = composer_drafts.version + 1`,
    [userId, conversationId, body.slice(0, 4000)],
  );
}

export async function loadComposerDrafts(userId: string): Promise<Record<string, string>> {
  const sql = await getSql();
  const rows = await sql.query<{ conversation_id: string; body: string }>(
    `select conversation_id, body from composer_drafts where user_id = $1`,
    [userId],
  );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.conversation_id] = row.body;
  return out;
}

export async function loadConversationControls(
  userId: string,
  conversationId: string,
): Promise<{ takeover: boolean; optOut: boolean }> {
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    `select coalesce(t.takeover, false) as takeover, coalesce(t.opt_out, false) as opt_out
       from agent_threads t
      where t.user_id = $1
        and (
          t.id = $2
          or t.telegram_account_id = $2
          or t.fan_id in (select id from agent_fans where user_id = $1 and tg_peer_id = $2)
        )
      limit 1`,
    [userId, conversationId],
  );
  const row = rows[0];
  return {
    takeover: row ? colBool(row, "takeover") : false,
    optOut: row ? colBool(row, "opt_out") : false,
  };
}

export async function acknowledgeVisibleChat(
  userId: string,
  conversationId: string,
  ack: ReadAckInput,
): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ unread: number }>(
    `select unread from telegram_chats where user_id = $1 and id = $2`,
    [userId, conversationId],
  );
  const unread = Number(rows[0]?.unread ?? 0);
  if (!shouldMarkRead(ack)) return unread;
  await sql.query(
    `insert into conversation_read_acks (user_id, conversation_id, last_visible_at)
     values ($1,$2, now())
     on conflict (user_id, conversation_id)
     do update set last_visible_at = now()`,
    [userId, conversationId],
  );
  const cleared = await sql.query<{ unread: number }>(
    `update telegram_chats set unread = 0
      where user_id = $1 and id = $2 and unread = $3
      returning unread`,
    [userId, conversationId, unread],
  );
  if (!cleared[0]) {
    const again = await sql.query<{ unread: number }>(
      `select unread from telegram_chats where user_id = $1 and id = $2`,
      [userId, conversationId],
    );
    return again[0]?.unread ?? unread;
  }
  return 0;
}

export async function seedIsolatedPreview(userId: string): Promise<void> {
  if (!demoFixturesAllowed()) return;
  const bind = await ensureBinding(userId);
  const fixture = isolatedFixtureSet();
  await withTransaction(async (sql) => {
    for (const chat of fixture.chats) {
      const id = `${chat.id}_${userId.slice(0, 8)}`;
      const existing = await sql.query<{ id: string }>(
        `select id from telegram_chats where user_id = $1 and id = $2`,
        [userId, id],
      );
      if (existing[0]) continue;
      await sql.query(
        `insert into telegram_chats (id, user_id, kind, title, last_preview, last_at, unread, peer_id, provider_last_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$6)`,
        [
          id,
          userId,
          chat.title === "Saved Messages" ? "notes" : "user",
          chat.title,
          chat.preview,
          chat.lastAt,
          chat.unread,
          chat.peerId,
        ],
      );
    }
    for (const msg of fixture.messages) {
      const chatId = `${msg.chatId}_${userId.slice(0, 8)}`;
      const id = `${msg.id}_${userId.slice(0, 8)}`;
      const exists = await sql.query<{ id: string }>(`select id from telegram_messages where id = $1`, [id]);
      if (exists[0]) continue;
      await sql.query(
        `insert into telegram_messages
           (id, user_id, chat_id, from_self, author_name, body, created_at, status, provider_at, origin, send_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          userId,
          chatId,
          msg.fromSelf,
          msg.authorName,
          msg.body,
          msg.createdAt,
          msg.status === "confirmed" ? "sent" : msg.status === "draft" ? "draft" : msg.status,
          msg.providerAt,
          msg.status === "draft" ? "local_note" : "observed_partner",
          msg.status,
        ],
      );
    }
  });

  const alexId = `${fixture.draft.chatId}_${userId.slice(0, 8)}`;
  await saveComposerDraft(userId, alexId, fixture.draft.body);

  const sql = await getSql();
  const briefs = await sql.query<{ id: string }>(
    `select id from business_briefs where user_id = $1 limit 1`,
    [userId],
  );
  if (!briefs[0]) {
    const briefId = newOperatorId("brief");
    const revId = newOperatorId("rev");
    const offerId = newOperatorId("off");
    const serviceKey = serviceKeyFromTitle(fixture.offer.title);
    const structured: StructuredBusiness = {
      displayName: "Northlight notes",
      about: "Quiet photo notes for collectors. Stored stills, not a live sitting.",
      voice: "",
      boundaries: "No live sittings. Stored stills only.",
      paymentCopy: "Approved USD instructions: send to the listed handle. Workspace credits never settle this.",
      destinationHint: "@northlight_pay",
      reviewQuestions: [],
      sourceBrief: "Northlight notes\nQuiet photo notes for collectors.",
      offers: [
        {
          serviceKey,
          title: fixture.offer.title,
          amountMinor: fixture.offer.amountMinor,
          currency: fixture.offer.currency,
          available: true,
          description: "Two stills. Stored media, not a live sitting.",
        },
      ],
    };
    await withTransaction(async (tx) => {
      await tx.query(`insert into business_briefs (id, user_id, binding_id, plain_text) values ($1,$2,$3,$4)`, [
        briefId,
        userId,
        bind.id,
        structured.sourceBrief,
      ]);
      await tx.query(
        `insert into business_revisions
           (id, user_id, binding_id, brief_id, revision, status, isolated, structured_json, published_at)
         values ($1,$2,$3,$4,1,'published', true, $5, now())`,
        [revId, userId, bind.id, briefId, JSON.stringify(structured)],
      );
      await tx.query(
        `insert into business_offers
           (id, user_id, binding_id, revision_id, service_key, title, amount_minor, currency, available, status, description)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true,'published',$9)`,
        [
          offerId,
          userId,
          bind.id,
          revId,
          serviceKey,
          fixture.offer.title,
          fixture.offer.amountMinor,
          fixture.offer.currency,
          "Two stills. Stored media, not a live sitting.",
        ],
      );
      await tx.query(
        `insert into payment_instructions (id, user_id, binding_id, revision_id, public_copy, currency, approved)
         values ($1,$2,$3,$4,$5,$6, true)`,
        [newOperatorId("ins"), userId, bind.id, revId, structured.paymentCopy, fixture.offer.currency],
      );
      await tx.query(
        `insert into payment_destinations (id, user_id, binding_id, provider, destination_ref, currency)
         values ($1,$2,$3,'manual_handle','@northlight_pay',$4)`,
        [newOperatorId("dest"), userId, bind.id, fixture.offer.currency],
      );
    });
  }

  for (const asset of fixture.assets) {
    const id = `${asset.id}_${userId.slice(0, 8)}`;
    const exists = await sql.query<{ id: string }>(`select id from media_assets where id = $1`, [id]);
    if (exists[0]) continue;
    await sql.query(
      `insert into media_assets
         (id, user_id, binding_id, kind, title, mime, byte_size, storage_key, approval, proves_live_human)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
      [id, userId, bind.id, asset.kind, asset.title, asset.mime, asset.byteSize, asset.storageKey, asset.approval],
    );
  }
  for (const att of fixture.attachments) {
    const id = `${att.id}_${userId.slice(0, 8)}`;
    const conv = `${att.conversationId}_${userId.slice(0, 8)}`;
    const exists = await sql.query<{ id: string }>(`select id from incoming_attachments where id = $1`, [id]);
    if (exists[0]) continue;
    await sql.query(
      `insert into incoming_attachments
         (id, user_id, conversation_id, kind, caption, provider_media_id, bytes_available, provider_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, userId, conv, att.kind, att.caption, att.providerMediaId, att.bytesAvailable, att.providerAt],
    );
  }
}

function writerHealth(persona: Record<string, unknown>): GenerationHealth {
  const lastOk = persona.writer_last_ok;
  const lastAt = persona.writer_last_at ? new Date(String(persona.writer_last_at)).getTime() : null;
  const lastGenerationOk = lastOk === true || lastOk === "t" ? true : lastOk === false || lastOk === "f" ? false : null;
  return lastGenerationOk === true
    ? healthIsReady("route_capable")
      ? lastAt && Date.now() - lastAt < 30 * 60_000
        ? "recently_generated"
        : "route_capable"
      : "route_capable"
    : lastGenerationOk === false
      ? "degraded"
      : "configured";
}

export async function loadOperatorDesk(userId: string): Promise<{
  bindingId: string;
  creatorId: string;
  flags: FinalState;
  projection: PublishedProjection | null;
  payment: ReturnType<typeof publicPaymentView>;
  drafts: Record<string, string>;
  autoSend: boolean;
  desiredAutoReply: boolean;
  backgroundRun: boolean;
  effective: AutoReplyView;
  assets: Array<{
    id: string;
    title: string;
    kind: string;
    approval: string;
    provesLiveHuman: false;
  }>;
  attachments: Array<{
    id: string;
    conversationId: string;
    kind: string;
    caption: string | null;
    bytesAvailable: boolean;
  }>;
  activity: Array<{ id: string; conversationId: string; status: string; body: string; createdAt: string }>;
  labAllowed: boolean;
}> {
  if (demoFixturesAllowed()) {
    await seedIsolatedPreview(userId);
  }
  const bind = await ensureBinding(userId);
  const flags = await loadLiveFinalState(userId);
  const projection = await loadPublishedProjection(userId);
  const sql = await getSql();
  const persona = await sql.query<Record<string, unknown>>(
    `select auto_send, background_run, desired_auto_reply, writer_last_ok, writer_last_at
       from agent_personas where user_id = $1 limit 1`,
    [userId],
  );
  const ins = await sql.query<{
    id: string;
    public_copy: string;
    currency: string;
    approved: boolean;
    revision_id: string;
  }>(
    `select id, public_copy, currency, approved, revision_id from payment_instructions
      where user_id = $1 order by created_at desc limit 1`,
    [userId],
  );
  const dest = await sql.query<{
    id: string;
    provider: string;
    destination_ref: string;
    currency: string;
    credential_id: string | null;
  }>(
    projection
      ? `select id, provider, destination_ref, currency, credential_id from payment_destinations
          where user_id = $1 and binding_id = $2
            and revoked_at is null
            and ($3::text is null or currency = $3)
          order by created_at desc limit 1`
      : `select id, provider, destination_ref, currency, credential_id from payment_destinations
          where user_id = $1 and revoked_at is null order by created_at desc limit 1`,

    projection
      ? [userId, projection.bindingId, ins[0]?.currency ?? projection.offers[0]?.amount.currency ?? null]
      : [userId],
  );
  const assets = await sql.query<{
    id: string;
    title: string;
    kind: string;
    approval: string;
  }>(`select id, title, kind, approval from media_assets where user_id = $1 order by created_at desc`, [userId]);
  const attachments = await sql.query<{
    id: string;
    conversation_id: string;
    kind: string;
    caption: string | null;
    bytes_available: boolean;
  }>(
    `select id, conversation_id, kind, caption, bytes_available from incoming_attachments
      where user_id = $1 order by provider_at desc`,
    [userId],
  );
  const activity = await sql.query<{
    id: string;
    conversation_id: string;
    status: string;
    body: string;
    created_at: string | Date;
  }>(
    `select id, conversation_id, status, body, created_at
       from send_attempts where user_id = $1
       order by created_at desc limit 40`,
    [userId],
  );
  const uncertain = activity.some((a) => a.status === "uncertain");
  const desiredAutoReply = colBool(persona[0] ?? {}, "desired_auto_reply") || colBool(persona[0] ?? {}, "auto_send");
  const health = writerHealth(persona[0] ?? {});
  const effective = effectiveAutoReply({
    desiredAutoReply,
    emergencyStop: flags.emergencyStop,
    processingPermission: flags.processingPermission,
    connected: flags.accountLive,
    publishedOffers: projection?.offers.filter((o) => o.available && o.status === "published").length ?? 0,
    writerReady: healthIsReady(health),
    takeover: flags.takeover,
    optOut: flags.optOut,
    uncertainSend: uncertain,
    awaitingPaymentVerification: false,
    lastSuccessAt: persona[0]?.writer_last_at ? String(persona[0].writer_last_at) : null,
  });
  return {
    bindingId: bind.id,
    creatorId: bind.creatorId,
    flags,
    projection,
    payment: publicPaymentView({
      instruction: ins[0]
        ? {
            id: ins[0].id,
            creatorId: bind.creatorId,
            bindingId: bind.id,
            revisionId: ins[0].revision_id,
            publicCopy: ins[0].public_copy,
            currency: ins[0].currency,
            approved: ins[0].approved,
          }
        : null,
      destination: dest[0]
        ? {
            id: dest[0].id,
            creatorId: bind.creatorId,
            bindingId: bind.id,
            provider: dest[0].provider,
            destinationRef: dest[0].destination_ref,
            currency: dest[0].currency,
            hasCredential: Boolean(dest[0].credential_id),
          }
        : null,
    }),
    drafts: await loadComposerDrafts(userId),
    autoSend: Boolean(persona[0]?.auto_send) && flags.automationMode === "approved_auto",
    desiredAutoReply,
    backgroundRun: Boolean(persona[0]?.background_run),
    effective,
    assets: assets.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      approval: a.approval,
      provesLiveHuman: false as const,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      conversationId: a.conversation_id,
      kind: a.kind,
      caption: a.caption,
      bytesAvailable: a.bytes_available,
    })),
    activity: activity.map((a) => ({
      id: a.id,
      conversationId: a.conversation_id,
      status: a.status,
      body: a.body,
      createdAt: a.created_at instanceof Date ? a.created_at.toISOString() : String(a.created_at),
    })),
    labAllowed: demoFixturesAllowed(),
  };
}

export async function publishBusinessFromBrief(
  userId: string,
  input: {
    plainText: string;
    offers: Array<{ title: string; amountMinor: number; currency: string; available: boolean; serviceKey?: string }>;
    paymentCopy: string;
    destinationRef: string;
  },
): Promise<PublishedProjection> {
  const bind = await ensureBinding(userId);
  const structuredOffers = input.offers.map((offer) => ({
    serviceKey: offer.serviceKey?.trim() || serviceKeyFromTitle(offer.title),
    title: offer.title,
    amountMinor: offer.amountMinor,
    currency: offer.currency,
    available: offer.available,
    description: "",
  }));
  const fromBrief = (() => {
    try {
      return input.plainText.trim() ? draftFromBrief(input.plainText) : null;
    } catch {
      return null;
    }
  })();
  const structured: StructuredBusiness = {
    displayName: input.plainText.trim().split("\n")[0]?.slice(0, 80) || "Business",
    about: input.plainText.trim().split("\n").slice(1).join(" ").slice(0, 500),
    voice: fromBrief?.voice ?? "",
    boundaries: fromBrief?.boundaries ?? "",
    paymentCopy: input.paymentCopy.trim(),
    destinationHint: input.destinationRef.trim(),
    reviewQuestions: fromBrief?.reviewQuestions ?? [],
    sourceBrief: input.plainText,
    offers: structuredOffers,
  };

  const gate = canPublish(structured);
  if (!gate.ok) throw new Error(gate.reason);

  const published = await withTransaction(async (sql: Sql) => {
    await sql.query(`select id from operator_bindings where id = $1 and user_id = $2 for update`, [
      bind.id,
      userId,
    ]);
    const last = await sql.query<{ revision: number }>(
      `select revision from business_revisions where binding_id = $1 order by revision desc limit 1`,
      [bind.id],
    );
    const revision = (last[0]?.revision ?? 0) + 1;
    const briefId = newOperatorId("brief");
    const revId = newOperatorId("rev");
    await sql.query(`insert into business_briefs (id, user_id, binding_id, plain_text) values ($1,$2,$3,$4)`, [
      briefId,
      userId,
      bind.id,
      input.plainText,
    ]);
    await sql.query(
      `update business_revisions set status = 'superseded' where user_id = $1 and binding_id = $2 and status = 'published'`,
      [userId, bind.id],
    );
    await sql.query(
      `insert into business_revisions
         (id, user_id, binding_id, brief_id, revision, status, isolated, structured_json, published_at)
       values ($1,$2,$3,$4,$5,'published', false, $6, now())`,
      [revId, userId, bind.id, briefId, revision, JSON.stringify(structured)],
    );
    for (const offer of structuredOffers) {
      await sql.query(
        `insert into business_offers
           (id, user_id, binding_id, revision_id, service_key, title, amount_minor, currency, available, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          newOperatorId("off"),
          userId,
          bind.id,
          revId,
          offer.serviceKey,
          offer.title,
          offer.amountMinor,
          offer.currency,
          offer.available,
          offer.available ? "published" : "unavailable",
        ],
      );
    }
    if (input.paymentCopy.trim()) {
      await sql.query(
        `insert into payment_instructions (id, user_id, binding_id, revision_id, public_copy, currency, approved)
         values ($1,$2,$3,$4,$5,$6,true)`,
        [newOperatorId("ins"), userId, bind.id, revId, input.paymentCopy.trim(), structuredOffers[0]!.currency],
      );
    }
    await sql.query(
      `update payment_destinations
          set revoked_at = now()
        where user_id = $1 and binding_id = $2 and revoked_at is null`,
      [userId, bind.id],
    );
    if (input.destinationRef.trim()) {
      await sql.query(
        `insert into payment_destinations (id, user_id, binding_id, provider, destination_ref, currency, revision_id)
         values ($1,$2,$3,'manual_handle',$4,$5,$6)`,
        [
          newOperatorId("dest"),
          userId,
          bind.id,
          input.destinationRef.trim(),
          structuredOffers[0]!.currency,
          revId,
        ],
      );
    }

    await sql.query(
      `update agent_personas set permission_revision = permission_revision where user_id = $1`,
      [userId],
    );
    return loadPublishedProjection(userId, { allowIsolated: false, bindingId: bind.id });
  });
  if (!published) throw new Error("publish_failed");
  return published;
}

export async function recordPaymentEvidence(
  userId: string,
  input: { offerId: string; amountMinor: number; currency: string; destinationId: string },
): Promise<{ accepted: boolean; reason?: string; provenance: "evidence_candidate" }> {
  const sql = await getSql();
  const offer = await sql.query<{
    amount_minor: number;
    currency: string;
    binding_id: string | null;
    revision_id: string | null;
  }>(`select amount_minor, currency, binding_id, revision_id from business_offers where id = $1 and user_id = $2`, [
    input.offerId,
    userId,
  ]);
  const dest = await sql.query<{ id: string }>(
    `select id from payment_destinations
      where user_id = $1
        and revoked_at is null
        and ($2::text is null or binding_id = $2)
        and ($3::text is null or currency = $3)
        and ($4::text is null or revision_id is null or revision_id = $4)
        and ($5::text is null or id = $5)
      order by created_at desc limit 1`,

    [userId, offer[0]?.binding_id ?? null, offer[0]?.currency ?? null, offer[0]?.revision_id ?? null, input.destinationId],
  );
  if (!offer[0] || !dest[0]) return { accepted: false, reason: "missing", provenance: "evidence_candidate" };
  const decision = evaluatePaymentEvidence({
    offerAmount: money(Number(offer[0].amount_minor), offer[0].currency),
    offerCurrency: offer[0].currency,
    evidenceAmount: money(input.amountMinor, input.currency),
    destinationId: input.destinationId,
    expectedDestinationId: dest[0].id,
  });
  const status = decision.accept
    ? "accepted"
    : decision.reason === "wrong_currency"
      ? "rejected_currency"
      : decision.reason === "wrong_destination"
        ? "rejected_destination"
        : "rejected_amount";
  await sql.query(
    `insert into payment_evidence
       (id, user_id, offer_id, amount_minor, currency, destination_id, provenance, status)
     values ($1,$2,$3,$4,$5,$6,'evidence_candidate',$7)`,
    [newOperatorId("ev"), userId, input.offerId, input.amountMinor, input.currency, input.destinationId, status],
  );
  return decision.accept
    ? { accepted: true, provenance: "evidence_candidate" }
    : { accepted: false, reason: decision.reason, provenance: "evidence_candidate" };
}

export function capturedFromOpts(opts: {
  accountGeneration?: number;
  consentEpoch?: number;
  permissionRevision?: number;
  takeover?: boolean;
  optOut?: boolean;
  emergencyStop?: boolean;
  processingPermission?: boolean;
  conversationPermitted?: boolean;
  accountLive?: boolean;
}): FinalState {
  const processingPermission = Boolean(opts.processingPermission);
  return cloneFinalState({
    accountGeneration: opts.accountGeneration ?? 1,
    consentEpoch: opts.consentEpoch ?? 1,
    permissionRevision: opts.permissionRevision ?? 1,
    businessRevision: null,
    emergencyStop: Boolean(opts.emergencyStop),
    takeover: Boolean(opts.takeover),
    optOut: Boolean(opts.optOut),
    automationMode: "approved_auto",
    processingPermission,
    conversationPermitted: opts.conversationPermitted ?? (processingPermission && !opts.optOut),
    accountLive: opts.accountLive !== false,
    assetApprovalOk: true,
  });
}

export async function recordDispatchAttempt(input: {
  userId: string;
  conversationId: string;
  body: string;
  captured: FinalState;
  live: FinalState;
  status: string;
}): Promise<string> {
  const sql = await getSql();
  const id = newOperatorId("att");
  await sql.query(
    `insert into send_attempts
       (id, user_id, conversation_id, body, status, captured_json, live_json)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.userId,
      input.conversationId,
      input.body.slice(0, 4000),
      input.status,
      JSON.stringify(input.captured),
      JSON.stringify(input.live),
    ],
  );
  return id;
}

export async function finishDispatchAttempt(
  userId: string,
  attemptId: string,
  status: string,
  reason?: string | null,
  transportMessageId?: string | number | null,
): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update send_attempts
        set status = $3,
            uncertain_reason = $4,
            transport_message_id = $5,
            reconciled_as = case
              when $3 = 'confirmed' then 'confirmed'
              when $3 = 'canceled' then 'canceled'
              when $3 = 'failed' then 'failed'
              else reconciled_as
            end,
            updated_at = now()
      where id = $2 and user_id = $1`,
    [userId, attemptId, status, reason ?? null, transportMessageId == null ? null : String(transportMessageId)],
  );
}

export async function pickIngestPeerIds(userId: string, now = Date.now()): Promise<string[]> {
  const sql = await getSql();
  const chats = await sql.query<{ id: string; peer_id: string | null }>(
    `select id, peer_id from telegram_chats where user_id = $1 and kind = 'user'`,
    [userId],
  );
  if (chats.length === 0) return [];
  const existing = await sql.query<{
    conversation_id: string;
    last_attempt_at: string | Date | null;
    next_eligible_at: string | Date | null;
    error_count: number;
  }>(`select conversation_id, last_attempt_at, next_eligible_at, error_count from ingest_cursors where user_id = $1`, [
    userId,
  ]);
  const byId = new Map(existing.map((r) => [r.conversation_id, r]));
  const { nextIngestBatch } = await import("./ingest.ts");
  const cursors = chats.map((c) => {
    const row = byId.get(c.id);
    return {
      conversationId: c.id,
      lastProviderAt: null,
      lastAttemptAt: row?.last_attempt_at ? new Date(row.last_attempt_at).getTime() : 0,
      nextEligibleAt: row?.next_eligible_at ? new Date(row.next_eligible_at).getTime() : 0,
      errorCount: row?.error_count ?? 0,
    };
  });
  const batch = nextIngestBatch(cursors, now);
  for (const cursor of batch) {
    await sql.query(
      `insert into ingest_cursors (user_id, conversation_id, last_attempt_at, next_eligible_at, error_count)
       values ($1,$2, now(), now() + interval '15 seconds', 0)
       on conflict (user_id, conversation_id)
       do update set last_attempt_at = now(), next_eligible_at = now() + interval '15 seconds', error_count = 0`,
      [userId, cursor.conversationId],
    );
  }
  const ids = new Set(batch.map((c) => c.conversationId));
  return chats.filter((c) => ids.has(c.id)).map((c) => c.peer_id).filter((p): p is string => Boolean(p));
}

export async function loadScopedFacts(
  userId: string,
  customerId: string,
  limit = 12,
): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql.query<{ subject: string; predicate: string; value: string }>(
    `select subject, predicate, value
       from memory_facts
      where user_id = $1 and customer_id = $2 and status = 'active'
        and (expires_at is null or expires_at > now())
      order by recorded_at desc
      limit $3`,
    [userId, customerId, limit],
  );
  return rows.map((r) => `${r.subject} ${r.predicate} ${r.value}`.trim());
}

export async function recordScopedFact(input: {
  userId: string;
  customerId: string;
  accountId?: string | null;
  subject: string;
  predicate: string;
  value: string;
  sourceEventId?: string | null;
  speaker: "customer" | "operator" | "assistant";
  assertion: "asserted" | "inferred";
  confidence: number;
}): Promise<void> {
  const predicate = input.predicate.slice(0, 80);
  const value = input.value.slice(0, 400);
  await withTransaction(async (sql) => {
    const existing = await sql.query<{ id: string }>(
      `select id from memory_facts
        where user_id = $1 and customer_id = $2 and predicate = $3 and value = $4 and status = 'active'
        limit 1`,
      [input.userId, input.customerId, predicate, value],
    );
    if (existing[0]) return;
    try {
      await sql.query(
        `with superseded as (
           update memory_facts
              set status = 'superseded'
            where user_id = $1 and customer_id = $2 and predicate = $3 and status = 'active' and value <> $4
           returning id
         )
         insert into memory_facts
           (id, user_id, customer_id, account_id, subject, predicate, value, source_event_id, speaker, assertion, confidence, status)
         select $5,$1,$2,$6,$7,$3,$4,$8,$9,$10,$11,'active'
          where not exists (
            select 1 from memory_facts
             where user_id = $1 and customer_id = $2 and predicate = $3 and status = 'active'
          )`,
        [
          input.userId,
          input.customerId,
          predicate,
          value,
          newOperatorId("fact"),
          input.accountId ?? null,
          input.subject.slice(0, 80),
          input.sourceEventId ?? null,
          input.speaker,
          input.assertion,
          Math.max(0, Math.min(1, input.confidence)),
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) return;
      throw err;
    }
  });
}

export async function retractScopedPredicate(input: {
  userId: string;
  customerId: string;
  predicate: string;
  value?: string;
}): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `update memory_facts
        set status = 'deleted'
      where user_id = $1
        and customer_id = $2
        and predicate = $3
        and status = 'active'
        and ($4::text is null or lower(value) = lower($4))
      returning id`,
    [input.userId, input.customerId, input.predicate.slice(0, 80), input.value?.slice(0, 400) ?? null],
  );
  return rows.length;
}

export async function forgetScopedFact(userId: string, factId: string): Promise<boolean> {

  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `update memory_facts set status = 'deleted'
      where id = $1 and user_id = $2 and status <> 'deleted'
      returning id`,
    [factId, userId],
  );
  return Boolean(rows[0]);
}

export async function correctScopedFact(
  userId: string,
  factId: string,
  value: string,
): Promise<boolean> {
  const sql = await getSql();
  return withTransaction(async (tx) => {
    const prev = await tx.query<{
      customer_id: string;
      account_id: string | null;
      subject: string;
      predicate: string;
      speaker: string;
    }>(
      `select customer_id, account_id, subject, predicate, speaker
         from memory_facts where id = $1 and user_id = $2 and status = 'active'`,
      [factId, userId],
    );
    if (!prev[0]) return false;
    await tx.query(`update memory_facts set status = 'superseded' where id = $1 and user_id = $2`, [
      factId,
      userId,
    ]);
    await tx.query(
      `insert into memory_facts
         (id, user_id, customer_id, account_id, subject, predicate, value, speaker, assertion, confidence, status, supersedes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'asserted',1,'active',$9)`,
      [
        newOperatorId("fact"),
        userId,
        prev[0].customer_id,
        prev[0].account_id,
        prev[0].subject,
        prev[0].predicate,
        value.slice(0, 400),
        prev[0].speaker,
        factId,
      ],
    );
    return true;
  });
}

export async function snapshotQuote(
  userId: string,
  input: {
    customerId: string;
    bindingId: string;
    offerId: string;
    serviceKey: string;
    title: string;
    amountMinor: number;
    currency: string;
    destinationId?: string | null;
    businessRevision: number;
  },
): Promise<QuoteView | { error: string }> {
  const built = quoteFromOffer({
    sku: input.serviceKey,
    title: input.title,
    amountMinor: input.amountMinor,
    currency: input.currency,
    destinationId: input.destinationId,
    businessRevision: input.businessRevision,
    customerId: input.customerId,
  });
  if ("error" in built) return built;
  const sql = await getSql();
  await sql.query(
    `insert into operator_quotes
       (id, user_id, customer_id, binding_id, offer_id, service_key, amount_minor, currency, destination_id, business_revision, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open')`,
    [
      newOperatorId("quo"),
      userId,
      input.customerId,
      input.bindingId,
      input.offerId,
      built.sku,
      built.amount.minor,
      built.amount.currency,
      built.destinationId,
      built.businessRevision,
    ],
  );
  return quoteView(built);
}

export async function eraseOperatorDerivedData(userId: string): Promise<{ tables: number; rows: number }> {
  let rows = 0;
  await withTransaction(async (tx) => {
    for (const table of OPERATOR_ERASE_TABLES) {
      const deleted = await tx.query<{ n: number }>(
        `with gone as (delete from ${table} where user_id = $1 returning 1) select count(*)::int as n from gone`,
        [userId],
      );
      rows += Number(deleted[0]?.n ?? 0);
    }
  });
  return { tables: OPERATOR_ERASE_TABLES.length, rows };
}

