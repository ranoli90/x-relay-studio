/**
 * Isolated operator kernel. Fake transport only — no live Telegram.
 * Callers that need SQL persist through persist.server.ts.
 */
import { newOperatorId } from "./ids.ts";
import { money, type Money } from "./money.ts";
import {
  applyTransportOutcome,
  canRetryAttempt,
  cloneFinalState,
  reconcileUncertain,
  revalidateForSend,
  type FinalState,
  type SendAttempt,
  type SendStatus,
} from "./state.ts";
import { applyReadAck, type ReadAckInput } from "./unread.ts";
import { selectConfirmedHistory, type HistoryItem } from "./history.ts";
import { markIngestAttempt, nextIngestBatch, type IngestCursor } from "./ingest.ts";
import {
  addOfferToDraft,
  canPublish,
  draftFromBrief,
  offerForGeneration,
  planningCatalog,
  projectPublished,
  type BusinessOffer,
  type BusinessRevision,
  type PublishedProjection,
  type StructuredBusiness,
} from "./business.ts";
import { evaluatePaymentEvidence, publicPaymentView, type PaymentDestination, type PaymentInstruction } from "./payments.ts";
import {
  canProposeAsset,
  deliveryAfterTransport,
  type IncomingAttachment,
  type LibraryAsset,
  type MediaProposal,
} from "./media.ts";

export type TransportKind =
  | { kind: "sent_confirmed"; transportMessageId: string }
  | { kind: "failed_definitive"; reason: string }
  | { kind: "uncertain"; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "canceled_stale"; reason: string }
  | { kind: "not_live"; reason: string };

export type FakeTransport = {
  blocked: boolean;
  hang: boolean;
  next: TransportKind | null;
  sent: Array<{ conversationId: string; body: string; assetId?: string }>;
  waiters: Array<(value: TransportKind) => void>;
  block(): void;
  unblock(): void;
  setNext(next: TransportKind): void;
  startHang(): void;
  releaseHang(result: TransportKind): void;
  send(conversationId: string, body: string, assetId?: string): Promise<TransportKind>;
};

export function createFakeTransport(): FakeTransport {
  const t: FakeTransport = {
    blocked: false,
    hang: false,
    next: null,
    sent: [],
    waiters: [],
    block() {
      t.blocked = true;
    },
    unblock() {
      t.blocked = false;
    },
    setNext(next) {
      t.next = next;
    },
    startHang() {
      t.hang = true;
    },
    releaseHang(result) {
      t.hang = false;
      const waiters = t.waiters.splice(0);
      for (const w of waiters) w(result);
    },
    async send(conversationId, body, assetId) {
      if (t.blocked) return { kind: "blocked", reason: "transport_blocked" };
      if (t.hang) {
        return await new Promise<TransportKind>((resolve) => {
          t.waiters.push((result) => {
            if (result.kind === "sent_confirmed") t.sent.push({ conversationId, body, assetId });
            resolve(result);
          });
        });
      }
      const preset = t.next;
      t.next = null;
      if (preset) {
        if (preset.kind === "sent_confirmed") t.sent.push({ conversationId, body, assetId });
        return preset;
      }
      t.sent.push({ conversationId, body, assetId });
      return { kind: "sent_confirmed", transportMessageId: newOperatorId("tg") };
    },
  };
  return t;
}

export type Conversation = {
  id: string;
  bindingId: string;
  creatorId: string;
  title: string;
  unread: number;
  peerId: string;
};

export type OperatorWorld = {
  now: number;
  userId: string;
  creatorId: string;
  bindingId: string;
  accountId: string;
  flags: FinalState;
  briefId: string | null;
  revisions: BusinessRevision[];
  offers: BusinessOffer[];
  instruction: PaymentInstruction | null;
  destination: PaymentDestination | null;
  conversations: Conversation[];
  history: HistoryItem[];
  drafts: Record<string, string>;
  attachments: IncomingAttachment[];
  assets: LibraryAsset[];
  proposals: MediaProposal[];
  attempts: SendAttempt[];
  cursors: IngestCursor[];
  transport: FakeTransport;
};

export function defaultFlags(): FinalState {
  return {
    accountGeneration: 1,
    consentEpoch: 1,
    permissionRevision: 1,
    businessRevision: null,
    emergencyStop: false,
    takeover: false,
    optOut: false,
    automationMode: "draft",
    processingPermission: true,
    conversationPermitted: true,
    accountLive: true,
    assetApprovalOk: true,
  };
}

export function createWorld(opts?: Partial<Pick<OperatorWorld, "userId" | "creatorId">>): OperatorWorld {
  const userId = opts?.userId ?? "user_test";
  const creatorId = opts?.creatorId ?? "creator_test";
  const bindingId = newOperatorId("bind");
  return {
    now: 1_700_000_000_000,
    userId,
    creatorId,
    bindingId,
    accountId: newOperatorId("acct"),
    flags: defaultFlags(),
    briefId: null,
    revisions: [],
    offers: [],
    instruction: null,
    destination: null,
    conversations: [],
    history: [],
    drafts: {},
    attachments: [],
    assets: [],
    proposals: [],
    attempts: [],
    cursors: [],
    transport: createFakeTransport(),
  };
}

export function liveFlags(world: OperatorWorld): FinalState {
  return cloneFinalState(world.flags);
}

export function publishedProjection(world: OperatorWorld): PublishedProjection | null {
  const published = world.revisions.find((r) => r.status === "published");
  if (!published) return null;
  return projectPublished(published, world.offers);
}

export function submitBrief(world: OperatorWorld, plain: string): BusinessRevision {
  const structured = draftFromBrief(plain);
  const briefId = newOperatorId("brief");
  world.briefId = briefId;
  const revision: BusinessRevision = {
    id: newOperatorId("rev"),
    creatorId: world.creatorId,
    bindingId: world.bindingId,
    briefId,
    revision: (world.revisions.at(-1)?.revision ?? 0) + 1,
    status: "draft",
    structured,
  };
  world.revisions.push(revision);
  return revision;
}

export function editDraft(
  world: OperatorWorld,
  revisionId: string,
  mutate: (draft: StructuredBusiness) => StructuredBusiness,
): BusinessRevision {
  const rev = world.revisions.find((r) => r.id === revisionId);
  if (!rev) throw new Error("revision_missing");
  if (rev.status === "published") throw new Error("published_immutable");
  rev.structured = mutate(rev.structured);
  rev.status = "review";
  return rev;
}

export function addBenignOffer(
  world: OperatorWorld,
  revisionId: string,
  input: { title: string; amountMinor: number; currency: string; available?: boolean },
): BusinessOffer {
  const rev = editDraft(world, revisionId, (d) => addOfferToDraft(d, input));
  const last = rev.structured.offers.at(-1)!;
  const offer: BusinessOffer = {
    id: newOperatorId("off"),
    creatorId: world.creatorId,
    bindingId: world.bindingId,
    revisionId: rev.id,
    title: last.title,
    amount: money(last.amountMinor, last.currency),
    available: last.available,
    status: "draft",
  };
  world.offers.push(offer);
  return offer;
}

export function publishRevision(world: OperatorWorld, revisionId: string): PublishedProjection {
  const rev = world.revisions.find((r) => r.id === revisionId);
  if (!rev) throw new Error("revision_missing");
  const gate = canPublish(rev.structured);
  if (!gate.ok) throw new Error(gate.reason);
  for (const prev of world.revisions) {
    if (prev.status === "published") prev.status = "superseded";
  }
  rev.status = "published";
  for (const offer of world.offers) {
    if (offer.revisionId === rev.id) {
      offer.status = offer.available ? "published" : "unavailable";
    } else if (offer.status === "published") {
      offer.status = "unavailable";
    }
  }
  world.flags = {
    ...world.flags,
    businessRevision: rev.revision,
  };
  const projection = projectPublished(rev, world.offers);
  if (!projection) throw new Error("publish_failed");
  return projection;
}

export async function dispatchAttempt(
  world: OperatorWorld,
  input: {
    conversationId: string;
    body: string;
    captured: FinalState;
    assetId?: string;
  },
): Promise<SendAttempt> {
  const attempt: SendAttempt = {
    id: newOperatorId("att"),
    conversationId: input.conversationId,
    body: input.body,
    status: "sending",
    captured: input.captured,
    transportMessageId: null,
    uncertainReason: null,
    reconciledAs: null,
  };
  world.attempts.push(attempt);

  if (input.assetId) {
    const asset = world.assets.find((a) => a.id === input.assetId) ?? null;
    const gate = canProposeAsset(asset);
    if (!gate.ok) {
      attempt.status = "canceled";
      attempt.uncertainReason = gate.reason;
      attempt.reconciledAs = "canceled";
      return attempt;
    }
  }

  const outcome = await world.transport.send(input.conversationId, input.body, input.assetId);
  const live = liveFlags(world);
  const check = revalidateForSend(input.captured, live);
  if (!check.allow) {
    const canceled = applyTransportOutcome(attempt, {
      kind: "canceled_stale",
      reason: check.reason,
    });
    Object.assign(attempt, canceled);
    return attempt;
  }
  const next = applyTransportOutcome(attempt, outcome);
  Object.assign(attempt, next);
  if (attempt.status === "confirmed") {
    world.history.push({
      id: newOperatorId("msg"),
      kind: "confirmed_outbound",
      body: input.body,
      providerAt: new Date(world.now).toISOString(),
      localAt: new Date(world.now).toISOString(),
    });
  }
  return attempt;
}

export function retryAttempt(world: OperatorWorld, attemptId: string): SendAttempt | { error: string } {
  const attempt = world.attempts.find((a) => a.id === attemptId);
  if (!attempt) return { error: "missing" };
  const gate = canRetryAttempt(attempt);
  if (!gate.allow) return { error: gate.reason };
  return attempt;
}

export function ackVisible(world: OperatorWorld, conversationId: string, ack: ReadAckInput): number {
  const chat = world.conversations.find((c) => c.id === conversationId);
  if (!chat) return 0;
  chat.unread = applyReadAck(chat.unread, ack);
  return chat.unread;
}

export function saveDraft(world: OperatorWorld, conversationId: string, body: string): void {
  if (!body.trim()) delete world.drafts[conversationId];
  else world.drafts[conversationId] = body;
}

export function historyForModel(world: OperatorWorld, limit: number): HistoryItem[] {
  return selectConfirmedHistory(world.history, limit);
}

export function tickIngest(world: OperatorWorld): IngestCursor[] {
  const batch = nextIngestBatch(world.cursors, world.now);
  for (const cursor of batch) {
    const idx = world.cursors.findIndex((c) => c.conversationId === cursor.conversationId);
    if (idx >= 0) world.cursors[idx] = markIngestAttempt(cursor, world.now, true);
  }
  return batch;
}

export { planningCatalog, offerForGeneration, evaluatePaymentEvidence, publicPaymentView, reconcileUncertain, deliveryAfterTransport };
