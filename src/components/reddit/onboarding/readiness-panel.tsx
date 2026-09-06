import type { ReadinessCheck, ReadinessReport } from "@/lib/reddit/onboarding/types";
import { cn } from "@/lib/utils";

const CHECKS: Array<{ key: ReadinessCheck["key"]; label: string }> = [
  { key: "owner", label: "Correct owner" },
  { key: "identity", label: "Reddit identity" },
  { key: "access", label: "Access valid" },
  { key: "recovery", label: "Recovery method" },
  { key: "restriction", label: "Account restriction" },
  { key: "permissions", label: "App permissions" },
  { key: "community", label: "Community suitability" },
  { key: "session", label: "Remote session" },
];

function emptyReport(accountId: string): ReadinessReport {
  return {
    accountId,
    checks: CHECKS.map((c) => ({
      key: c.key,
      label: c.label,
      status: "unknown",
      reason: "Not observed yet.",
      lastObservedAt: null,
    })),
    inventedReputation: false,
    cqsClaim: null,
  };
}

function formatObserved(value: string | null): string {
  if (!value) return "Not observed";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function ReadinessPanel({
  accountId,
  accountName,
  report,
}: {
  accountId: string;
  accountName?: string;
  report?: ReadinessReport | null;
}) {
  const data = report ?? emptyReport(accountId);
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Readiness</p>
      <h2 className="mt-2 text-lg font-medium tracking-tight">
        Evidence for {accountName ? `u/${accountName}` : "this account"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Each check stands on its own. Unknown stays unknown. This is not a score, not CQS, and not
        permission to post.
      </p>
      <ul className="mt-4 space-y-3">
        {data.checks.map((check) => (
          <li key={check.key} className="rounded-lg border border-line bg-bg px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{check.label}</p>
              <p
                className={cn(
                  "font-mono text-[11px] uppercase tracking-wider",
                  check.status === "unknown" ? "text-subtle" : "text-fg",
                )}
              >
                {check.status}
              </p>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{check.reason || "No reason recorded."}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-subtle">
              Last observed {formatObserved(check.lastObservedAt)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Reputation is not invented. CQS is not estimated.
        {data.cqsClaim ? "" : " No CQS claim."}
      </p>
    </section>
  );
}
