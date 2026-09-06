import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DraftPublic, EmailBindingPublic, ReadinessReport } from "@/lib/reddit/onboarding/types";
import { ReadinessPanel } from "./readiness-panel";
import { DraftComposer } from "./draft-composer";
import { EmailBindingPanel } from "./email-binding";

type Panel = "none" | "readiness" | "reconnect" | "retained" | "email" | "draft";

export type RetainedSignInView = {
  retentionRequested: boolean;
  retentionStatus: string;
  expiresAt: string | null;
};

function formatExpiry(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function retentionCopy(status: string): string {
  switch (status) {
    case "requested":
      return "Retention requested — not saved until persistence is confirmed.";
    case "temporary":
      return "Temporary browser state. Not retained.";
    case "retained":
      return "Retained sign-in.";
    case "needs_reauth":
      return "Needs the same-account sign-in again.";
    case "expired":
      return "Retention expired.";
    case "delete_pending":
      return "Deletion requested, waiting for confirmation.";
    case "deleted":
      return "Retained sign-in deleted.";
    case "failed":
      return "Retention failed.";
    default:
      return "No retained browser sign-in is stored.";
  }
}

export function AccountActions({
  accountId,
  accountName,
  readiness,
  bindings,
  profile,
  draft,
  busy,
  error,
  onReconnect,
  onCloseBrowser,
  onDisconnectRelay,
  onDeleteRetained,
  onGenerateDraft,
  onCreateEmail,
  onDeleteEmail,
}: {
  accountId: string;
  accountName: string;
  readiness?: ReadinessReport | null;
  bindings?: EmailBindingPublic[];
  profile?: RetainedSignInView | null;
  draft?: DraftPublic | null;
  busy?: boolean;
  error?: string | null;
  onReconnect?: () => void;
  onCloseBrowser?: () => void;
  onDisconnectRelay?: () => void;
  onDeleteRetained?: () => void;
  onGenerateDraft?: (input: {
    communityAllowlist: string[];
    topic: string;
    assertedFacts: string;
    selectedCommunity?: string;
  }) => void;
  onCreateEmail?: (input: { address: string; kind: "existing_inbox" }) => void;
  onDeleteEmail?: (bindingId: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>("none");
  const retained = profile?.retentionStatus === "retained";
  const expiry = retained ? formatExpiry(profile?.expiresAt) : null;

  return (
    <section className="border-b border-line px-4 py-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtle">Account actions</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setPanel("readiness")}>
          Readiness
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPanel("reconnect")}>
          Reconnect
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPanel("retained")}>
          Retained sign-in
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPanel("email")}>
          Recovery email
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPanel("draft")}>
          Draft a post
        </Button>
      </div>

      {panel === "readiness" ? (
        <div className="mt-4">
          <ReadinessPanel accountId={accountId} accountName={accountName} report={readiness} />
        </div>
      ) : null}

      {panel === "reconnect" ? (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-lg font-medium tracking-tight">Reconnect the same account</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Reconnect uses Reddit login for u/{accountName}. Expired cookies need the same account
            again. A restriction pauses this account; it does not create a replacement.
          </p>
          <Button type="button" className="mt-4" disabled={busy} onClick={onReconnect}>
            Reconnect with Reddit
          </Button>
        </div>
      ) : null}

      {panel === "retained" ? (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-lg font-medium tracking-tight">Retained browser sign-in</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {profile ? retentionCopy(profile.retentionStatus) : "No retained browser sign-in is stored."}
            {retained && expiry ? ` Expires ${expiry}.` : ""}
            {profile?.retentionRequested && !retained
              ? " A request is not the same as a saved sign-in."
              : ""}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" disabled={busy} onClick={onCloseBrowser}>
              Close browser
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onDisconnectRelay}>
              Disconnect X Relay
            </Button>
            <Button type="button" variant="ghost" disabled={busy || !profile} onClick={onDeleteRetained}>
              Delete retained sign-in
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-subtle">
            Closing the browser is not disconnecting X Relay. Disconnecting X Relay does not delete
            the Reddit account.
          </p>
        </div>
      ) : null}

      {panel === "email" ? (
        <div className="mt-4">
          <EmailBindingPanel
            bindings={bindings}
            busy={busy}
            error={error}
            onCreate={onCreateEmail}
            onDelete={onDeleteEmail}
          />
        </div>
      ) : null}

      {panel === "draft" ? (
        <div className="mt-4">
          <DraftComposer
            accountName={accountName}
            draft={draft}
            busy={busy}
            error={error}
            onGenerate={onGenerateDraft}
          />
        </div>
      ) : null}
    </section>
  );
}
