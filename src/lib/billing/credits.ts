/** Pure credit-burn / lot-order rules. No database. */

export type Lot = {
  id: string;
  kind: "refill" | "topup";
  remaining: number;
  expiresAt: string | null;
};

export type BurnReason =
  | "killed"
  | "parked"
  | "takeover"
  | "already_billed"
  | "failed_model"
  | "aftercare"
  | "human_only"
  | "no_credits";

export type BurnDecision = { burn: true } | { burn: false; reason: BurnReason };

export type BurnEvent = {
  safetyKilled: boolean;
  parked: boolean;
  takeoverNoModel: boolean;
  alreadyBilled: boolean;
  aftercare: boolean;
  failedModel: boolean;
  humanOnly: boolean;
  availableCredits: number;
};

export function decideBurn(e: BurnEvent): BurnDecision {
  if (e.safetyKilled) return { burn: false, reason: "killed" };
  if (e.alreadyBilled) return { burn: false, reason: "already_billed" };
  if (e.aftercare) return { burn: false, reason: "aftercare" };
  if (e.parked) return { burn: false, reason: "parked" };
  if (e.takeoverNoModel) return { burn: false, reason: "takeover" };
  if (e.humanOnly) return { burn: false, reason: "human_only" };
  if (e.failedModel) return { burn: false, reason: "failed_model" };
  if (e.availableCredits < 1) return { burn: false, reason: "no_credits" };
  return { burn: true };
}

export function liveLots(lots: Lot[], nowMs = Date.now()): Lot[] {
  return lots.filter((lot) => {
    if (lot.remaining <= 0) return false;
    if (lot.expiresAt && Date.parse(lot.expiresAt) <= nowMs) return false;
    return true;
  });
}

export function availableCredits(lots: Lot[], nowMs = Date.now()): number {
  return liveLots(lots, nowMs).reduce((n, lot) => n + lot.remaining, 0);
}

/** Refill first (soonest expiry), then never-expire top-ups. */
export function burnOrder(lots: Lot[], nowMs = Date.now()): Lot[] {
  const live = liveLots(lots, nowMs);
  const refills = live
    .filter((l) => l.kind === "refill")
    .sort((a, b) => Date.parse(a.expiresAt ?? "9") - Date.parse(b.expiresAt ?? "9"));
  const topups = live.filter((l) => l.kind === "topup").sort((a, b) => a.id.localeCompare(b.id));
  return [...refills, ...topups];
}

export function takeOne(lots: Lot[], nowMs = Date.now()): { lots: Lot[]; took: Lot | null } {
  const order = burnOrder(lots, nowMs);
  const target = order[0];
  if (!target) return { lots: lots.map((l) => ({ ...l })), took: null };
  return {
    lots: lots.map((l) => (l.id === target.id ? { ...l, remaining: l.remaining - 1 } : { ...l })),
    took: target,
  };
}

export function expireRefills(lots: Lot[], nowMs = Date.now()): Lot[] {
  return lots.map((lot) => {
    if (lot.kind !== "refill" || !lot.expiresAt) return { ...lot };
    if (Date.parse(lot.expiresAt) > nowMs) return { ...lot };
    return { ...lot, remaining: 0 };
  });
}
