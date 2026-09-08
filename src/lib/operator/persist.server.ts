import { getSql } from "@/lib/db";
import { demoFixturesAllowed } from "@/lib/runtime";
import type { CatalogRow } from "@/lib/agent/types.ts";
import { parseAutomationMode } from "@/lib/conversation/policy.ts";
import { newOperatorId } from "./ids.ts";
import { isolatedFixtureSet } from "./fixtures.ts";
import { cloneFinalState, type FinalState } from "./state.ts";
import { shouldMarkRead, type ReadAckInput } from "./unread.ts";
import { planningCatalog, type PublishedProjection, type StructuredBusiness } from "./business.ts";
import { evaluatePaymentEvidence, publicPaymentView } from "./payments.ts";
import { money } from "./money.ts";

function colBool(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  return v === true || v === "t" || v === "true" || v === 1;
}

function colInt(row: Record<string, unknown>, key: string, fallback = 0): number {
  const v = row[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadLiveFinalState(
  userId: string,
  threadId?: string | null,
): Promise<FinalState> {
  const sql = await getSql();
  const personas = await sql.query<Record<string, unknown>>(
    `select automation_mode, emergency_stop, auto_send, permission_revision, processing_permission,
            profile_revision
       from agent_personas where user_id = $1 limit 1`,
    [userId],
  ).catch(() => [] as Record<string, unknown>[]);
  const persona = personas[0] ?? {};
  let thread: Record<string, unknown> = {};
  if (threadId) {
    const rows = await sql.query<Record<string, unknown>>(
      `select takeover, opt_out, consent_epoch, account_generation, telegram_account_id
         from agent_threads where id = $1 and user_id = $2 limit 1`,
      [threadId, userId],
    ).catch(() => [] as Record<string, unknown>[]);
    thread = rows[0] ?? {};
  }
  const sessions = await sql.query<Record<string, unknown>>(
    `select emergency_stop, account_generation, watching, auth_dead, session_enc
       from telegram_user_sessions where user_id = $1 limit 1`,
    [userId],
  ).catch(() => [] as Record<string, unknown>[]);
  const session = sessions[0] ?? {};
  const published = await sql.query<{ revision: number }>(
    `select revision from business_revisions
      where user_id = $1 and status = 'published'
      order by revision desc limit 1`,
    [userId],
  ).catch(() => [] as { revision: number }[]);

  const emergencyStop = colBool(persona, "emergency_stop") || colBool(session, "emergency_stop");
  const accountLive = Boolean(session.session_enc) && !colBool(session, "auth_dead");
  return {
    accountGeneration: colInt(thread, "account_generation", colInt(session, "account_generation", 1)),
    consentEpoch: colInt(thread, "consent_epoch", 1),
    permissionRevision: colInt(persona, "permission_revision", 1),
    businessRevision: published[0]?.revision ?? null,
    emergencyStop,
    takeover: colBool(thread, "takeover"),
    optOut: colBool(thread, "opt_out"),
    automationMode: parseAutomationMode(persona.automation_mode),
    processingPermission: colBool(persona, "processing_permission"),
    conversationPermitted: !colBool(thread, "opt_out"),
    accountLive,
    assetApprovalOk: true,
  };
}

export async function loadPublishedProjection(userId: string): Promise<PublishedProjection | null> {
  const sql = await getSql();
  const revs = await sql.query<{
    id: string;
    binding_id: string;
    revision: number;
    structured_json: string;
  }>(
    `select r.id, r.binding_id, r.revision, r.structured_json
       from business_revisions r
      where r.user_id = $1 and r.status = 'published'
      order by r.revision desc limit 1`,
    [userId],
  );
  const rev = revs[0];
  if (!rev) return null;
  const structured = JSON.parse(rev.structured_json) as StructuredBusiness;
  const offers = await sql.query<{
    id: string;
    binding_id: string;
    revision_id: string;
    title: string;
    amount_minor: number;
    currency: string;
    available: boolean;
    status: string;
  }>(
    `select id, binding_id, revision_id, title, amount_minor, currency, available, status
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
    paymentCopy: structured.paymentCopy,
    offers: offers.map((o) => ({
      id: o.id,
      creatorId,
      bindingId: o.binding_id,
      revisionId: o.revision_id,
      title: o.title,
      amount: money(Number(o.amount_minor), o.currency),
      available: o.available,
      status: o.status as "draft" | "approved" | "published" | "unavailable",
    })),
  };
}

export async function catalogForPlanning(userId: string, _fallback: CatalogRow[] = []): Promise<CatalogRow[]> {
  void _fallback;
  const published = await loadPublishedProjection(userId);
  const rows = planningCatalog(published);
  if (rows.length > 0) {
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      title: r.title,
      priceCents: r.priceCents,
      rail: "operator",
      eligibility: "any",
    }));
  }
  return [];
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
     values ($1,$2,$3,$4)`,
    [id, userId, userId, creatorId],
  );
  return { id, creatorId };
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
     do update set body = excluded.body, updated_at = now()`,
    [userId, conversationId, body.slice(0, 4000)],
  );
}

export async function loadComposerDrafts(userId: string): Promise<Record<string, string>> {
  const sql = await getSql();
  const rows = await sql.query<{ conversation_id: string; body: string }>(
    `select conversation_id, body from composer_drafts where user_id = $1`,
    [userId],
  ).catch(() => [] as { conversation_id: string; body: string }[]);
  const out: Record<string, string> = {};
  for (const row of rows) out[row.conversation_id] = row.body;
  return out;
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
  const unread = rows[0]?.unread ?? 0;
  if (!shouldMarkRead(ack)) return unread;
  await sql.query(
    `insert into conversation_read_acks (user_id, conversation_id, last_visible_at)
     values ($1,$2, now())
     on conflict (user_id, conversation_id)
     do update set last_visible_at = now()`,
    [userId, conversationId],
  );
  await sql.query(`update telegram_chats set unread = 0 where user_id = $1 and id = $2`, [
    userId,
    conversationId,
  ]);
  return 0;
}

export async function seedIsolatedPreview(userId: string): Promise<void> {
  if (!demoFixturesAllowed()) return;
  const sql = await getSql();
  const bind = await ensureBinding(userId);
  const fixture = isolatedFixtureSet();
  for (const chat of fixture.chats) {
    const id = `${chat.id}_${userId.slice(0, 8)}`;
    const existing = await sql.query<{ id: string }>(
      `select id from telegram_chats where user_id = $1 and id = $2`,
      [userId, id],
    );
    if (existing[0]) continue;
    await sql.query(
      `insert into telegram_chats (id, user_id, kind, title, last_preview, last_at, unread, peer_id, provider_last_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$5)`,
      [id, userId, chat.title === "Saved Messages" ? "notes" : "user", chat.title, chat.preview, chat.lastAt, chat.unread, chat.peerId],
    );
  }
  for (const msg of fixture.messages) {
    const chatId = `${msg.chatId}_${userId.slice(0, 8)}`;
    const id = `${msg.id}_${userId.slice(0, 8)}`;
    const exists = await sql.query<{ id: string }>(
      `select id from telegram_messages where id = $1`,
      [id],
    );
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
  const alexId = `${fixture.draft.chatId}_${userId.slice(0, 8)}`;
  await saveComposerDraft(userId, alexId, fixture.draft.body);

  const briefs = await sql.query<{ id: string }>(
    `select id from business_briefs where user_id = $1 limit 1`,
    [userId],
  );
  if (!briefs[0]) {
    const briefId = newOperatorId("brief");
    const revId = newOperatorId("rev");
    const offerId = newOperatorId("off");
    const structured: StructuredBusiness = {
      displayName: "Northlight notes",
      about: "Quiet photo notes for collectors. Stored stills, not a live sitting.",
      paymentCopy: "Approved USD instructions: send to the listed handle. Workspace credits never settle this.",
      offers: [
        {
          title: fixture.offer.title,
          amountMinor: fixture.offer.amountMinor,
          currency: fixture.offer.currency,
          available: true,
        },
      ],
    };
    await sql.query(
      `insert into business_briefs (id, user_id, binding_id, plain_text) values ($1,$2,$3,$4)`,
      [briefId, userId, bind.id, "Northlight notes\nQuiet photo notes for collectors."],
    );
    await sql.query(
      `insert into business_revisions (id, user_id, binding_id, brief_id, revision, status, structured_json, published_at)
       values ($1,$2,$3,$4,1,'published',$5, now())`,
      [revId, userId, bind.id, briefId, JSON.stringify(structured)],
    );
    await sql.query(
      `insert into business_offers (id, user_id, binding_id, revision_id, title, amount_minor, currency, available, status)
       values ($1,$2,$3,$4,$5,$6,$7,true,'published')`,
      [offerId, userId, bind.id, revId, fixture.offer.title, fixture.offer.amountMinor, fixture.offer.currency],
    );
    await sql.query(
      `insert into payment_instructions (id, user_id, binding_id, revision_id, public_copy, currency, approved)
       values ($1,$2,$3,$4,$5,'USD', true)`,
      [
        newOperatorId("ins"),
        userId,
        bind.id,
        revId,
        structured.paymentCopy,
      ],
    );
    await sql.query(
      `insert into payment_destinations (id, user_id, binding_id, provider, destination_ref, currency)
       values ($1,$2,$3,'manual_handle','@northlight_pay','USD')`,
      [newOperatorId("dest"), userId, bind.id],
    );
    await sql.query(
      `update agent_personas set permission_revision = permission_revision
        where user_id = $1`,
      [userId],
    ).catch(() => undefined);
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

export async function loadOperatorDesk(userId: string): Promise<{
  bindingId: string;
  creatorId: string;
  flags: FinalState;
  projection: PublishedProjection | null;
  payment: ReturnType<typeof publicPaymentView>;
  drafts: Record<string, string>;
  autoSend: boolean;
  backgroundRun: boolean;
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
  labAllowed: boolean;
}> {
  const bind = await ensureBinding(userId);
  const flags = await loadLiveFinalState(userId);
  const projection = await loadPublishedProjection(userId);
  const sql = await getSql();
  const persona = await sql.query<{ auto_send: boolean; background_run: boolean }>(
    `select auto_send, background_run from agent_personas where user_id = $1 limit 1`,
    [userId],
  ).catch(() => [] as { auto_send: boolean; background_run: boolean }[]);
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
  ).catch(() => []);
  const dest = await sql.query<{
    id: string;
    provider: string;
    destination_ref: string;
    currency: string;
    credential_id: string | null;
  }>(
    `select id, provider, destination_ref, currency, credential_id from payment_destinations
      where user_id = $1 order by created_at desc limit 1`,
    [userId],
  ).catch(() => []);
  const assets = await sql.query<{
    id: string;
    title: string;
    kind: string;
    approval: string;
  }>(
    `select id, title, kind, approval from media_assets where user_id = $1 order by created_at desc`,
    [userId],
  ).catch(() => []);
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
  ).catch(() => []);
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
    backgroundRun: Boolean(persona[0]?.background_run),
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
    labAllowed: demoFixturesAllowed(),
  };
}

export async function publishBusinessFromBrief(
  userId: string,
  input: {
    plainText: string;
    offers: Array<{ title: string; amountMinor: number; currency: string; available: boolean }>;
    paymentCopy: string;
    destinationRef: string;
  },
): Promise<PublishedProjection> {
  const sql = await getSql();
  const bind = await ensureBinding(userId);
  const briefId = newOperatorId("brief");
  const last = await sql.query<{ revision: number }>(
    `select revision from business_revisions where binding_id = $1 order by revision desc limit 1`,
    [bind.id],
  );
  const revision = (last[0]?.revision ?? 0) + 1;
  const revId = newOperatorId("rev");
  const structured: StructuredBusiness = {
    displayName: input.plainText.trim().split("\n")[0]?.slice(0, 80) || "Business",
    about: input.plainText.trim().split("\n").slice(1).join(" ").slice(0, 500),
    paymentCopy: input.paymentCopy.trim(),
    offers: input.offers,
  };
  await sql.query(
    `update business_revisions set status = 'superseded' where user_id = $1 and status = 'published'`,
    [userId],
  );
  await sql.query(
    `insert into business_briefs (id, user_id, binding_id, plain_text) values ($1,$2,$3,$4)`,
    [briefId, userId, bind.id, input.plainText],
  );
  await sql.query(
    `insert into business_revisions (id, user_id, binding_id, brief_id, revision, status, structured_json, published_at)
     values ($1,$2,$3,$4,$5,'published',$6, now())`,
    [revId, userId, bind.id, briefId, revision, JSON.stringify(structured)],
  );
  for (const offer of input.offers) {
    await sql.query(
      `insert into business_offers (id, user_id, binding_id, revision_id, title, amount_minor, currency, available, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        newOperatorId("off"),
        userId,
        bind.id,
        revId,
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
      [newOperatorId("ins"), userId, bind.id, revId, input.paymentCopy.trim(), input.offers[0]?.currency ?? "USD"],
    );
  }
  if (input.destinationRef.trim()) {
    await sql.query(
      `insert into payment_destinations (id, user_id, binding_id, provider, destination_ref, currency)
       values ($1,$2,$3,'manual_handle',$4,$5)`,
      [newOperatorId("dest"), userId, bind.id, input.destinationRef.trim(), input.offers[0]?.currency ?? "USD"],
    );
  }
  const published = await loadPublishedProjection(userId);
  if (!published) throw new Error("publish_failed");
  return published;
}

export async function recordPaymentEvidence(
  userId: string,
  input: { offerId: string; amountMinor: number; currency: string; destinationId: string },
): Promise<{ accepted: boolean; reason?: string }> {
  const sql = await getSql();
  const offer = await sql.query<{
    amount_minor: number;
    currency: string;
  }>(
    `select amount_minor, currency from business_offers where id = $1 and user_id = $2`,
    [input.offerId, userId],
  );
  const dest = await sql.query<{ id: string }>(
    `select id from payment_destinations where user_id = $1 order by created_at desc limit 1`,
    [userId],
  );
  if (!offer[0] || !dest[0]) return { accepted: false, reason: "missing" };
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
    `insert into payment_evidence (id, user_id, offer_id, amount_minor, currency, destination_id, status)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [newOperatorId("ev"), userId, input.offerId, input.amountMinor, input.currency, input.destinationId, status],
  );
  return decision.accept ? { accepted: true } : { accepted: false, reason: decision.reason };
}

export function capturedFromOpts(opts: {
  accountGeneration?: number;
  consentEpoch?: number;
  takeover?: boolean;
  optOut?: boolean;
  emergencyStop?: boolean;
}): FinalState {
  return {
    ...cloneFinalState({
      accountGeneration: opts.accountGeneration ?? 1,
      consentEpoch: opts.consentEpoch ?? 1,
      permissionRevision: 1,
      businessRevision: null,
      emergencyStop: Boolean(opts.emergencyStop),
      takeover: Boolean(opts.takeover),
      optOut: Boolean(opts.optOut),
      automationMode: "approved_auto",
      processingPermission: true,
      conversationPermitted: true,
      accountLive: true,
      assetApprovalOk: true,
    }),
  };
}

export async function recordDispatchAttempt(input: {
  userId: string;
  conversationId: string;
  body: string;
  captured: FinalState;
  live: FinalState;
  status: string;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into send_attempts
       (id, user_id, conversation_id, body, status, captured_json, live_json)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newOperatorId("att"),
      input.userId,
      input.conversationId,
      input.body.slice(0, 4000),
      input.status,
      JSON.stringify(input.captured),
      JSON.stringify(input.live),
    ],
  ).catch(() => undefined);
}

export async function finishDispatchAttempt(
  userId: string,
  conversationId: string,
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
      where id = (
        select id from send_attempts
         where user_id = $1 and conversation_id = $2
         order by created_at desc
         limit 1
      )`,
    [userId, conversationId, status, reason ?? null, transportMessageId == null ? null : String(transportMessageId)],
  ).catch(() => undefined);
}

export async function pickIngestPeerIds(userId: string, now = Date.now()): Promise<string[]> {
  const sql = await getSql();
  const chats = await sql.query<{ id: string; peer_id: string | null }>(
    `select id, peer_id from telegram_chats where user_id = $1 and kind = 'user'`,
    [userId],
  ).catch(() => [] as { id: string; peer_id: string | null }[]);
  if (chats.length === 0) return [];
  const existing = await sql.query<{
    conversation_id: string;
    last_attempt_at: string | Date | null;
    next_eligible_at: string | Date | null;
    error_count: number;
  }>(
    `select conversation_id, last_attempt_at, next_eligible_at, error_count
       from ingest_cursors where user_id = $1`,
    [userId],
  ).catch(() => []);
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
    ).catch(() => undefined);
  }
  const ids = new Set(batch.map((c) => c.conversationId));
  return chats.filter((c) => ids.has(c.id)).map((c) => c.peer_id).filter((p): p is string => Boolean(p));
}
