export type OauthTicketSnapshot = {
  user_id: string;
  redirect_uri: string;
  expires_at: string | Date;
  processing_state?: string | null;
  processed_result_json?: string | null;
  job_id?: string | null;
  expected_username?: string | null;
  expected_reddit_id?: string | null;
  correlation_id?: string | null;
  credential_version?: number | null;
  allowed_origin?: string | null;
  cancelled_at?: string | Date | null;
  purpose?: string | null;
  attempt_generation?: number | null;
  exchange_started_at?: string | Date | null;
};

export type OauthCallbackDecision =
  | { action: "reject"; error: "origin" | "correlation" | "cancelled" | "expired" | "purpose" | "generation" }
  | { action: "replay"; result: Record<string, unknown> }
  | { action: "busy" }
  | { action: "recover"; accountId: string; name: string }
  | { action: "uncertain" }
  | { action: "proceed" };

const PROCESSING_STALE_MS = 2 * 60 * 1000;

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function callbackOriginAllowed(ticket: OauthTicketSnapshot, requestOrigin: string): boolean {
  const allowed = originOf(ticket.allowed_origin);
  const redirect = originOf(ticket.redirect_uri);
  if (allowed) return allowed === requestOrigin;
  return redirect === requestOrigin;
}

export function popupMessageAccepted(opts: {
  expectedCorrelationId: string | null;
  messageCorrelationId?: string | null;
  origin: string;
  pageOrigin: string;
}): boolean {
  if (opts.origin !== opts.pageOrigin) return false;
  if (!opts.expectedCorrelationId) return false;
  if (!opts.messageCorrelationId) return false;
  return opts.expectedCorrelationId === opts.messageCorrelationId;
}

export function decideOauthCallback(opts: {
  ticket: OauthTicketSnapshot;
  requestOrigin: string;
  now?: number;
  linkedAccount?: { id: string; name: string } | null;
}): OauthCallbackDecision {
  const ticket = opts.ticket;
  const now = opts.now ?? Date.now();
  if (!callbackOriginAllowed(ticket, opts.requestOrigin)) {
    return { action: "reject", error: "origin" };
  }
  if (!ticket.correlation_id) {
    return { action: "reject", error: "correlation" };
  }
  const purpose = ticket.purpose || "connect_account";
  if (purpose !== "connect_account") {
    return { action: "reject", error: "purpose" };
  }
  if (ticket.attempt_generation != null && Number(ticket.attempt_generation) !== 1) {
    return { action: "reject", error: "generation" };
  }
  if (ticket.cancelled_at) {
    return { action: "reject", error: "cancelled" };
  }
  if (ticket.processed_result_json) {
    try {
      const prior = JSON.parse(ticket.processed_result_json) as Record<string, unknown>;
      return { action: "replay", result: prior };
    } catch {
      return { action: "reject", error: "expired" };
    }
  }
  if (new Date(ticket.expires_at).getTime() < now) {
    return { action: "reject", error: "expired" };
  }
  const state = ticket.processing_state || "open";
  if (state === "processing") {
    if (opts.linkedAccount) {
      return { action: "recover", accountId: opts.linkedAccount.id, name: opts.linkedAccount.name };
    }
    const started = ticket.exchange_started_at ? new Date(ticket.exchange_started_at).getTime() : 0;
    if (started && now - started > PROCESSING_STALE_MS) {
      return { action: "uncertain" };
    }
    return { action: "busy" };
  }
  if (state !== "open") {
    return { action: "busy" };
  }
  return { action: "proceed" };
}

export function revocationMaterialAad(opts: { userId: string; accountId?: string | null; jobId?: string | null }) {
  return {
    userId: opts.userId,
    recordId: opts.accountId || opts.userId,
    purpose: "oauth_revocation_material" as const,
  };
}
