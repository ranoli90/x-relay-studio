import {
  EMAIL_BINDING_KINDS,
  OnboardingError,
  type EmailBindingKind,
  type EmailBindingPublic,
} from "./types.ts";
import { encryptV2, decryptV2, maskEmail, sha256Hex } from "./vault.ts";
import type { SqlLike } from "./sql.ts";

const ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENSITIVE_INPUT =
  /^(otp|password|passwd|message_body|mail_body|code|token|refresh_token|access_token|cookie)$/i;

export type EmailBindingRow = {
  id: string;
  user_id: string;
  account_id: string | null;
  kind: EmailBindingKind;
  provider: string;
  provider_resource_ref: string | null;
  address_ciphertext: string;
  masked_display: string;
  domain_evidence_ref: string | null;
  destination_verified: boolean;
  destination_verified_at: string | Date | null;
  consent_version: string | null;
  consent_at: string | Date | null;
  status: string;
  quota_state: string | null;
  last_error_code: string | null;
  create_fingerprint: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at: string | Date | null;
};

export type CreateEmailBindingInput = {
  userId: string;
  accountId?: string | null;
  kind?: EmailBindingKind;
  provider?: string | null;
  domain?: string | null;
  address: string;
  consentVersion?: string;
  domainEvidenceRef?: string | null;
};

function assertNoSensitiveFields(input: Record<string, unknown>) {
  for (const key of Object.keys(input)) {
    if (SENSITIVE_INPUT.test(key)) {
      throw new OnboardingError("SENSITIVE_EMAIL_INPUT", "Recovery email cannot accept secrets, OTPs, or message bodies.");
    }
  }
}

export function normalizeEmail(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!ADDRESS_RE.test(value)) {
    throw new OnboardingError("INVALID_EMAIL", "Enter a valid email address.");
  }
  return value;
}

export function emailCreateFingerprint(opts: {
  userId: string;
  kind: string;
  provider: string;
  address: string;
}): string {
  return sha256Hex(`${opts.userId}|${opts.kind}|${opts.provider}|${normalizeEmail(opts.address)}`);
}

export function managedEmailAvailable(opts: {
  kind: EmailBindingKind;
  provider?: string | null;
  domain?: string | null;
}): { ok: boolean; reason: string | null } {
  if (opts.kind === "existing_inbox") return { ok: true, reason: null };
  const provider = opts.provider?.trim();
  const domain = opts.domain?.trim();
  if (!provider || !domain) {
    return {
      ok: false,
      reason: "Managed recovery email needs an explicit provider and domain. Use an existing inbox instead.",
    };
  }
  return { ok: true, reason: null };
}

export function toPublicBinding(row: EmailBindingRow): EmailBindingPublic {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    maskedDisplay: row.masked_display,
    status: row.status as EmailBindingPublic["status"],
    destinationVerified: Boolean(row.destination_verified),
    accountId: row.account_id,
  };
}

export async function listEmailBindings(
  sql: SqlLike,
  userId: string,
  accountId?: string | null,
): Promise<EmailBindingPublic[]> {
  const rows = accountId
    ? await sql.query<EmailBindingRow>(
        `select * from reddit_email_bindings
          where user_id = $1 and deleted_at is null
            and (account_id = $2 or account_id is null)
          order by created_at`,
        [userId, accountId],
      )
    : await sql.query<EmailBindingRow>(
        `select * from reddit_email_bindings
          where user_id = $1 and deleted_at is null
          order by created_at`,
        [userId],
      );
  return rows.map(toPublicBinding);
}

export async function createEmailBinding(
  sql: SqlLike,
  input: CreateEmailBindingInput,
): Promise<EmailBindingPublic> {
  assertNoSensitiveFields(input as unknown as Record<string, unknown>);
  const kind = input.kind ?? "existing_inbox";
  if (!(EMAIL_BINDING_KINDS as readonly string[]).includes(kind)) {
    throw new OnboardingError("INVALID_EMAIL_KIND", "Unknown email binding kind.");
  }
  const address = normalizeEmail(input.address);
  const provider = (input.provider?.trim() || (kind === "existing_inbox" ? "owner" : "")).toLowerCase();
  const availability = managedEmailAvailable({ kind, provider, domain: input.domain });
  if (!availability.ok) {
    throw new OnboardingError("EMAIL_PROVIDER_UNAVAILABLE", availability.reason || "Managed email is unavailable.");
  }

  if (kind !== "existing_inbox") {
    const blocked = await sql.query<{ id: string }>(
      `select id from reddit_email_bindings
        where user_id = $1
          and quota_state = 'quota_blocked'
          and deleted_at is null
        limit 1`,
      [input.userId],
    );
    if (blocked[0]) {
      throw new OnboardingError("QUOTA_BLOCKED", "Managed mailbox quota is exhausted. Use an existing inbox.");
    }
  }

  const fingerprint = emailCreateFingerprint({
    userId: input.userId,
    kind,
    provider,
    address,
  });
  const existing = await sql.query<EmailBindingRow>(
    `select * from reddit_email_bindings
      where user_id = $1 and create_fingerprint = $2 and deleted_at is null
      limit 1`,
    [input.userId, fingerprint],
  );
  if (existing[0]) return toPublicBinding(existing[0]);

  const id = crypto.randomUUID();
  const ciphertext = encryptV2(address, {
    userId: input.userId,
    recordId: id,
    purpose: "signup_email",
  });
  const status = kind === "existing_inbox" ? "requested" : "pending";
  const rows = await sql.query<EmailBindingRow>(
    `insert into reddit_email_bindings (
       id, user_id, account_id, kind, provider, address_ciphertext, masked_display,
       domain_evidence_ref, status, consent_version, consent_at, create_fingerprint
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)
     returning *`,
    [
      id,
      input.userId,
      input.accountId ?? null,
      kind,
      provider,
      ciphertext,
      maskEmail(address),
      input.domainEvidenceRef ?? input.domain ?? null,
      status,
      input.consentVersion ?? null,
      fingerprint,
    ],
  );
  return toPublicBinding(rows[0]);
}

export async function reconcilePendingCreate(
  sql: SqlLike,
  opts: {
    userId: string;
    fingerprint: string;
    providerResourceRef?: string | null;
    outcome: "created" | "quota_blocked" | "failed";
  },
): Promise<EmailBindingPublic | null> {
  const rows = await sql.query<EmailBindingRow>(
    `select * from reddit_email_bindings
      where user_id = $1 and create_fingerprint = $2 and deleted_at is null
      limit 1`,
    [opts.userId, opts.fingerprint],
  );
  const row = rows[0];
  if (!row) return null;
  const status = opts.outcome === "created" ? "requested" : opts.outcome === "quota_blocked" ? "quota_blocked" : "failed";
  const quota = opts.outcome === "quota_blocked" ? "quota_blocked" : row.quota_state;
  const updated = await sql.query<EmailBindingRow>(
    `update reddit_email_bindings
        set status = $3,
            quota_state = $4,
            provider_resource_ref = coalesce($5, provider_resource_ref),
            last_error_code = $6,
            updated_at = now()
      where id = $1 and user_id = $2
      returning *`,
    [
      row.id,
      opts.userId,
      status,
      quota,
      opts.providerResourceRef ?? null,
      opts.outcome === "created" ? null : opts.outcome,
    ],
  );
  return updated[0] ? toPublicBinding(updated[0]) : null;
}

export async function markDestinationVerified(
  sql: SqlLike,
  opts: { userId: string; bindingId: string },
): Promise<EmailBindingPublic> {
  const rows = await sql.query<EmailBindingRow>(
    `update reddit_email_bindings
        set destination_verified = true,
            destination_verified_at = now(),
            status = case when status = 'requested' or status = 'pending' then 'verified' else status end,
            updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning *`,
    [opts.bindingId, opts.userId],
  );
  if (!rows[0]) throw new OnboardingError("NOT_FOUND", "Recovery email not found.", 404);
  return toPublicBinding(rows[0]);
}

export async function deleteEmailBinding(
  sql: SqlLike,
  opts: { userId: string; bindingId: string },
): Promise<EmailBindingPublic> {
  const rows = await sql.query<EmailBindingRow>(
    `select * from reddit_email_bindings where id = $1 and user_id = $2 and deleted_at is null`,
    [opts.bindingId, opts.userId],
  );
  const row = rows[0];
  if (!row) throw new OnboardingError("NOT_FOUND", "Recovery email not found.", 404);
  if (row.destination_verified && row.account_id) {
    const alt = await sql.query<{ id: string }>(
      `select id from reddit_email_bindings
        where user_id = $1 and account_id = $2 and id <> $3
          and destination_verified = true and deleted_at is null
        limit 1`,
      [opts.userId, row.account_id, row.id],
    );
    if (!alt[0]) {
      throw new OnboardingError(
        "EMAIL_RECOVERY_REQUIRED",
        "Verify another recovery address for this account before deleting this one.",
      );
    }
  }
  const updated = await sql.query<EmailBindingRow>(
    `update reddit_email_bindings
        set status = 'deleted', deleted_at = now(), updated_at = now()
      where id = $1 and user_id = $2
      returning *`,
    [row.id, opts.userId],
  );
  return toPublicBinding(updated[0]);
}

export function redditEmailVerifiedFromBinding(_binding: EmailBindingPublic): false {
  return false;
}

export function decryptBoundAddress(row: EmailBindingRow): string {
  return decryptV2(row.address_ciphertext, {
    userId: row.user_id,
    recordId: row.id,
    purpose: "signup_email",
  });
}
