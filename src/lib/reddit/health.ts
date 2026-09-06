import type { HealthCheck, HealthReport } from "./types";

export type HealthMe = {
  name?: string;
  created_utc?: number;
  link_karma?: number;
  comment_karma?: number;
  total_karma?: number;
  has_verified_email?: boolean;
  is_suspended?: boolean;
};


export function ageDays(createdUtc: number | null | undefined, now = Date.now()) {
  if (!createdUtc) return null;
  return (now / 1000 - createdUtc) / 86400;
}

export function buildHealthReport(input: {
  me: HealthMe | null;
  apiError?: string | null;
  rateRemaining: number | null;
  publicProfile: "visible" | "hidden" | "unknown";
  now?: number;
}): HealthReport {
  const now = input.now ?? Date.now();
  const checks: HealthCheck[] = [];
  const me = input.me;

  if (input.apiError || !me) {
    checks.push({
      id: "api",
      label: "Reddit API",
      status: "fail",
      severity: "hard",
      detail: input.apiError || "Could not reach Reddit as this account.",
      fix: "Connect again with Continue with Reddit. If Reddit blocked the app, do not create a second app for the same use.",
    });
  } else {
    checks.push({
      id: "api",
      label: "Reddit API",
      status: "pass",
      severity: "hard",
      detail: "Signed in. Token works. X Relay only uses this connection for identity, classic inbox, and health — it does not send, post, or vote, even though Reddit’s privatemessages scope can also cover composing mail.",
    });
  }

  const suspended = Boolean(me?.is_suspended);
  checks.push({
    id: "suspended",
    label: "Account standing",
    status: !me ? "unknown" : suspended ? "fail" : "pass",
    severity: "hard",
    detail: suspended
      ? "This account is suspended."
      : "Reddit is not reporting this account as suspended.",
    fix: suspended
      ? "Stop. Appeal at reddit.com/appeal. Do not create a new account to continue."
      : undefined,
  });

  const email = Boolean(me?.has_verified_email);
  checks.push({
    id: "email",
    label: "Email verified",
    status: !me ? "unknown" : email ? "pass" : "fail",
    severity: "hard",
    detail: email
      ? "Email is verified on Reddit."
      : "Email is not verified. Reddit treats unverified accounts as higher risk.",
    fix: "Open reddit.com/settings/account and verify the email, then re-run this check.",
  });

  if (input.publicProfile === "hidden") {
    checks.push({
      id: "visible",
      label: "Visible logged out",
      status: "fail",
      severity: "hard",
      detail:
        "Logged-out Reddit did not return this profile. That is evidence of a restriction or a removed account — not a complete sitewide verdict.",
      fix: "Do not post. Check Reddit’s own tools. Appeal if needed. Do not open a new account to dodge this.",
    });
  } else if (input.publicProfile === "unknown") {
    checks.push({
      id: "visible",
      label: "Visible logged out",
      status: "unknown",
      severity: "soft",
      detail:
        "We could not prove this profile is public. Open reddit.com/user/" +
        (me?.name ?? "username") +
        " in a private window. Age and karma are observations, not eligibility guarantees.",
      fix: "If the private window says nobody goes by that name, this account is shadowbanned. Do not post. Do not create a new account.",
    });
  } else {
    checks.push({
      id: "visible",
      label: "Visible logged out",
      status: "pass",
      severity: "hard",
      detail: "Public profile loaded in this check. That is not a guarantee there is no restriction.",
    });
  }

  const days = ageDays(me?.created_utc, now);
  if (days == null) {
    checks.push({
      id: "age",
      label: "Account age",
      status: "unknown",
      severity: "soft",
      detail: "Could not read cake day.",
    });
  } else if (days < 1) {
    checks.push({
      id: "age",
      label: "Account age",
      status: "fail",
      severity: "soft",
      detail: `This account is ${Math.round(days * 24)} hours old. New accounts are what Reddit’s spam filter watches first.`,
      fix: "Read and comment for a week before any link post. This app will not post for you.",
    });
  } else if (days < 7) {
    checks.push({
      id: "age",
      label: "Account age",
      status: "warn",
      severity: "soft",
      detail: `This account is ${days.toFixed(1)} days old. Link posts before day 7 are a common filter trigger.`,
      fix: "Keep using Reddit as a person. Do not blast links.",
    });
  } else {
    checks.push({
      id: "age",
      label: "Account age",
      status: "pass",
      severity: "soft",
      detail: `Account is ${Math.floor(days)} days old.`,
    });
  }

  const commentKarma = me?.comment_karma ?? 0;
  const totalKarma = me?.total_karma ?? (me?.link_karma ?? 0) + commentKarma;
  if (!me) {
    checks.push({
      id: "karma",
      label: "Karma",
      status: "unknown",
      severity: "soft",
      detail: "No karma yet.",
    });
  } else if (commentKarma < 10) {
    checks.push({
      id: "karma",
      label: "Karma",
      status: "warn",
      severity: "soft",
      detail: `${commentKarma} comment karma / ${totalKarma} total. Many communities drop posts under 10–50 comment karma.`,
      fix: "Comment in communities you actually read. Do not buy karma.",
    });
  } else {
    checks.push({
      id: "karma",
      label: "Karma",
      status: "pass",
      severity: "soft",
      detail: `${commentKarma} comment karma / ${totalKarma} total.`,
    });
  }

  if (input.rateRemaining != null && input.rateRemaining < 10) {
    checks.push({
      id: "ratelimit",
      label: "API headroom",
      status: "warn",
      severity: "soft",
      detail: `Only ${input.rateRemaining} Reddit API calls left in this window.`,
      fix: "Wait for the window to reset. We never retry in a loop.",
    });
  } else {
    checks.push({
      id: "ratelimit",
      label: "API headroom",
      status: "pass",
      severity: "info",
      detail:
        input.rateRemaining == null
          ? "Rate-limit headers were not present; we will still stay under 100 queries/minute."
          : `${Math.floor(input.rateRemaining)} calls remaining in this window.`,
    });
  }

  checks.push({
    id: "scopes",
    label: "Permissions",
    status: "pass",
    severity: "info",
    detail:
      "This app asked Reddit for identity, inbox, and read. X Relay still will not post, vote, or send. The token itself is not proof that sending is impossible.",
  });

  const apiOk = checks.some((c) => c.id === "api" && c.status === "pass");
  const suspendedFail = checks.some(
    (c) => c.id === "suspended" && c.status === "fail",
  );
  return {
    okToUse: apiOk && !suspendedFail,
    postingLocked: true,
    checks,
    ranAt: new Date(now).toISOString(),
  };
}

export async function probePublicProfile(
  name: string,
  userAgent: string,
): Promise<"visible" | "hidden" | "unknown"> {
  void name;
  void userAgent;
  return "unknown";
}
