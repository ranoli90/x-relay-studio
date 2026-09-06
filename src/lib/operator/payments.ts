import { parseCurrency, sameMoney, type Money } from "./money.ts";

export type PaymentInstruction = {
  id: string;
  creatorId: string;
  bindingId: string;
  revisionId: string;
  publicCopy: string;
  currency: string;
  approved: boolean;
};

export type PaymentDestination = {
  id: string;
  creatorId: string;
  bindingId: string;
  provider: string;
  destinationRef: string;
  currency: string;
  hasCredential: boolean;
};

/** Public view never includes envelopes, tokens, or webhook secrets. */
export function publicPaymentView(input: {
  instruction: PaymentInstruction | null;
  destination: PaymentDestination | null;
}): {
  copy: string | null;
  provider: string | null;
  destinationRef: string | null;
  currency: string | null;
  approved: boolean;
} {
  const instruction = input.instruction;
  const destination = input.destination;
  if (!instruction || !instruction.approved) {
    return {
      copy: null,
      provider: destination?.provider ?? null,
      destinationRef: null,
      currency: instruction?.currency ?? destination?.currency ?? null,
      approved: false,
    };
  }
  return {
    copy: instruction.publicCopy,
    provider: destination?.provider ?? null,
    destinationRef: destination?.destinationRef ?? null,
    currency: instruction.currency,
    approved: true,
  };
}

export type PaymentEvidence = {
  offerAmount: Money;
  offerCurrency: string;
  evidenceAmount: Money;
  destinationId: string;
  expectedDestinationId: string;
};

export type EvidenceDecision =
  | { accept: true }
  | { accept: false; reason: "wrong_currency" | "wrong_destination" | "wrong_amount" | "currency_missing" };

export function evaluatePaymentEvidence(ev: PaymentEvidence): EvidenceDecision {
  const offerC = parseCurrency(ev.offerCurrency) ?? parseCurrency(ev.offerAmount.currency);
  const evC = parseCurrency(ev.evidenceAmount.currency);
  if (!offerC || !evC) return { accept: false, reason: "currency_missing" };
  if (offerC !== evC) return { accept: false, reason: "wrong_currency" };
  if (ev.destinationId !== ev.expectedDestinationId) return { accept: false, reason: "wrong_destination" };
  if (!sameMoney({ minor: ev.offerAmount.minor, currency: offerC }, { minor: ev.evidenceAmount.minor, currency: evC })) {
    return { accept: false, reason: "wrong_amount" };
  }
  return { accept: true };
}

/** Workspace credits never settle a customer offer. */
export function creditLedgerKind(kind: "workspace_credit" | "customer_quote" | "payment_evidence" | "order"): string {
  return kind;
}

export function mixesCreditWithCustomer(kind: string, target: "customer_offer" | "workspace"): boolean {
  if (target === "customer_offer" && kind === "workspace_credit") return true;
  if (target === "workspace" && kind !== "workspace_credit") return true;
  return false;
}
