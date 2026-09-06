import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { DraftPublic } from "@/lib/reddit/onboarding/types";
import { CopyRow } from "../copy-row";

function parseAllowlist(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,]/)
        .map((v) => v.replace(/^r\//i, "").trim())
        .filter(Boolean),
    ),
  ];
}

export function DraftComposer({
  accountName,
  draft,
  directPublishEnabled = false,
  busy,
  error,
  onGenerate,
}: {
  accountName?: string;
  draft?: DraftPublic | null;
  directPublishEnabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onGenerate?: (input: {
    communityAllowlist: string[];
    topic: string;
    assertedFacts: string;
    selectedCommunity?: string;
  }) => void;
}) {
  const [allowlistText, setAllowlistText] = useState("");
  const [topic, setTopic] = useState("");
  const [facts, setFacts] = useState("");
  const [selected, setSelected] = useState("");
  const allowlist = useMemo(() => parseAllowlist(allowlistText), [allowlistText]);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Draft a post</p>
      <h2 className="mt-2 text-lg font-medium tracking-tight">
        Owner-reviewed draft{accountName ? ` for u/${accountName}` : ""}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        You supply the communities and a real topic. This does not post, vote, or farm karma. Default
        delivery is copy and open Reddit.
      </p>

      <label className="mt-4 block text-sm">
        Community allowlist
        <Textarea
          className="mt-2"
          value={allowlistText}
          onChange={(e) => setAllowlistText(e.target.value)}
          placeholder="One community per line. Do not leave this blank."
        />
      </label>
      <label className="mt-4 block text-sm">
        Topic
        <Input
          className="mt-2"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={200}
        />
      </label>
      <label className="mt-4 block text-sm">
        Facts you can actually stand behind
        <Textarea
          className="mt-2"
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
          placeholder="No invented first-person stories, credentials, or product claims."
        />
      </label>
      {allowlist.length ? (
        <label className="mt-4 block text-sm">
          Confirm community
          <select
            className="mt-2 h-12 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose from your list</option>
            {allowlist.map((c) => (
              <option key={c} value={c}>
                r/{c}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-3 text-sm text-muted">The model will not invent a community list.</p>
      )}

      {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}

      <Button
        type="button"
        className="mt-4 w-full"
        disabled={busy || !allowlist.length || !topic.trim()}
        onClick={() =>
          onGenerate?.({
            communityAllowlist: allowlist,
            topic: topic.trim(),
            assertedFacts: facts.trim(),
            selectedCommunity: selected || undefined,
          })
        }
      >
        {busy ? "Generating…" : "Generate draft"}
      </Button>

      {draft ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">
            r/{draft.community} · validation {draft.validationStatus} · approval {draft.approvalStatus}
          </p>
          {draft.fitExplanation ? (
            <p className="text-sm leading-relaxed text-muted">{draft.fitExplanation}</p>
          ) : null}
          <CopyRow label="Title" value={draft.title} />
          <CopyRow label="Body" value={draft.body} />
          <p className="text-xs leading-relaxed text-subtle">
            {directPublishEnabled
              ? "Direct publish is separately enabled and still needs an explicit approval for this exact version."
              : "Direct publish is off. Copy this and open Reddit yourself."}
            {draft.validationStatus === "rules_unknown"
              ? " Community rules are unknown, so this cannot auto-publish."
              : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
