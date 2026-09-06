import { newId } from "../../agent/ids.ts";
import { OnboardingError, type ReadinessCheck, type ReadinessReport } from "./types.ts";
import type { SqlLike } from "./sql.ts";

export const READINESS_CHECK_KEYS = [
  "owner",
  "identity",
  "access",
  "recovery",
  "restriction",
  "permissions",
  "community",
  "session",
] as const;

export type ReadinessCheckKey = (typeof READINESS_CHECK_KEYS)[number];

export const READINESS_LABELS: Record<ReadinessCheckKey, string> = {
  owner: "Correct owner",
  identity: "Reddit identity",
  access: "Access valid",
  recovery: "Recovery method",
  restriction: "Account restriction",
  permissions: "App permissions",
  community: "Community suitability",
  session: "Remote session",
};

const COLUMN_BY_KEY: Record<ReadinessCheckKey, string> = {
  owner: "owner_confirmed",
  identity: "identity_status",
  access: "access_status",
  recovery: "email_status",
  restriction: "restriction_status",
  permissions: "app_permission_status",
  community: "community_status",
  session: "session_status",
};

export type ReadinessRow = {
  id: string;
  user_id: string;
  account_id: string;
  owner_confirmed: string;
  identity_status: string;
  access_status: string;
  email_status: string;
  restriction_status: string;
  app_permission_status: string;
  community_status: string;
  session_status: string;
  reasons_json: string;
  last_observed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type CheckObservation = {
  status: string;
  reason?: string | null;
};

export type ReadinessReasons = Partial<
  Record<ReadinessCheckKey, { reason: string | null; lastObservedAt: string | null }>
>;

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function parseReasons(raw: string | null | undefined): ReadinessReasons {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ReadinessReasons;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function statusOf(row: ReadinessRow, key: ReadinessCheckKey): string {
  const value = row[COLUMN_BY_KEY[key] as keyof ReadinessRow];
  return typeof value === "string" && value ? value : "unknown";
}

export function toReadinessReport(row: ReadinessRow): ReadinessReport {
  const reasons = parseReasons(row.reasons_json);
  const checks: ReadinessCheck[] = READINESS_CHECK_KEYS.map((key) => {
    const meta = reasons[key];
    const status = statusOf(row, key) || "unknown";
    return {
      key,
      label: READINESS_LABELS[key],
      status,
      reason: meta?.reason ?? (status === "unknown" ? "Not observed yet." : null),
      lastObservedAt: meta?.lastObservedAt ?? null,
    };
  });
  return {
    accountId: row.account_id,
    checks,
    inventedReputation: false,
    cqsClaim: null,
  };
}

function emptyRow(userId: string, accountId: string): ReadinessRow {
  return {
    id: newId("rar"),
    user_id: userId,
    account_id: accountId,
    owner_confirmed: "unknown",
    identity_status: "unknown",
    access_status: "unknown",
    email_status: "unknown",
    restriction_status: "unknown",
    app_permission_status: "unknown",
    community_status: "unknown",
    session_status: "unknown",
    reasons_json: "{}",
    last_observed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function emptyReadinessReport(accountId: string): ReadinessReport {
  return toReadinessReport(emptyRow("unknown", accountId));
}

export async function getReadiness(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<ReadinessReport> {
  const rows = await sql.query<ReadinessRow>(
    `select * from reddit_account_readiness
      where user_id = $1 and account_id = $2
      limit 1`,
    [userId, accountId],
  );
  if (!rows[0]) return emptyReadinessReport(accountId);
  return toReadinessReport(rows[0]);
}

export async function observeReadiness(
  sql: SqlLike,
  opts: {
    userId: string;
    accountId: string;
    observations: Partial<Record<ReadinessCheckKey, CheckObservation>>;
  },
): Promise<ReadinessReport> {
  if (!opts.accountId) {
    throw new OnboardingError("ACCOUNT_REQUIRED", "Readiness is recorded per owned account.");
  }
  const existing = await sql.query<ReadinessRow>(
    `select * from reddit_account_readiness
      where user_id = $1 and account_id = $2
      limit 1`,
    [opts.userId, opts.accountId],
  );
  const base = existing[0] ?? emptyRow(opts.userId, opts.accountId);
  const reasons = parseReasons(base.reasons_json);
  const now = new Date().toISOString();
  const next = { ...base };

  for (const key of READINESS_CHECK_KEYS) {
    const observation = opts.observations[key];
    if (!observation) continue;
    const column = COLUMN_BY_KEY[key];
    (next as unknown as Record<string, string>)[column] = observation.status || "unknown";
    reasons[key] = {
      reason: observation.reason ?? (observation.status === "unknown" ? "Not observed yet." : null),
      lastObservedAt: now,
    };
  }

  const reasonsJson = JSON.stringify(reasons);
  const rows = await sql.query<ReadinessRow>(
    `insert into reddit_account_readiness (
       id, user_id, account_id,
       owner_confirmed, identity_status, access_status, email_status,
       restriction_status, app_permission_status, community_status, session_status,
       reasons_json, last_observed_at, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()
     )
     on conflict (user_id, account_id) do update set
       owner_confirmed = excluded.owner_confirmed,
       identity_status = excluded.identity_status,
       access_status = excluded.access_status,
       email_status = excluded.email_status,
       restriction_status = excluded.restriction_status,
       app_permission_status = excluded.app_permission_status,
       community_status = excluded.community_status,
       session_status = excluded.session_status,
       reasons_json = excluded.reasons_json,
       last_observed_at = excluded.last_observed_at,
       updated_at = now()
     returning *`,
    [
      base.id,
      opts.userId,
      opts.accountId,
      next.owner_confirmed,
      next.identity_status,
      next.access_status,
      next.email_status,
      next.restriction_status,
      next.app_permission_status,
      next.community_status,
      next.session_status,
      reasonsJson,
      now,
    ],
  );
  return toReadinessReport(rows[0]);
}

export function shouldPauseForRestriction(report: ReadinessReport): boolean {
  return report.checks.some((c) => c.key === "restriction" && c.status === "restricted");
}

export function replacementAccountForbidden(report: ReadinessReport): boolean {
  return shouldPauseForRestriction(report);
}
