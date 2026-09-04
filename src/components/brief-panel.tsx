import { Copy, LoaderCircle, ScanSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runBriefFn, runDraftFn } from "@/lib/research";
import { tweetsFromResult, useRelay } from "@/store/relay";

export function BriefPanel() {
  const result = useRelay((s) => s.result);
  const brief = useRelay((s) => s.brief);
  const draft = useRelay((s) => s.draft);
  const briefing = useRelay((s) => s.briefing);
  const drafting = useRelay((s) => s.drafting);
  const setBrief = useRelay((s) => s.setBrief);
  const setDraft = useRelay((s) => s.setDraft);
  const setBriefing = useRelay((s) => s.setBriefing);
  const setDrafting = useRelay((s) => s.setDrafting);
  const query = useRelay((s) => s.query);
  const [instruction, setInstruction] = useState("");

  const tweets = tweetsFromResult(result);
  if (!result || result.kind === "trends") return null;
  const current = result;
  const topic =
    current.kind === "search" || current.kind === "people" ? current.query : query || current.kind;
  const isThread = current.kind === "thread";

  async function briefThis() {
    setBriefing(true);
    try {
      const res = await runBriefFn({
        data: {
          query: topic,
          tweets: tweets.slice(0, 8).map((t) => ({
            handle: t.author.handle,
            text: t.text,
            likes: t.metrics.likes,
            url: t.url,
          })),
        },
      });
      if (res.ok) setBrief(res.brief);
      else toast.error(res.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Brief failed");
    } finally {
      setBriefing(false);
    }
  }

  async function draftThis() {
    setDrafting(true);
    try {
      const target = isThread
        ? { handle: current.kind === "thread" ? current.thread.root.author.handle : "", text: current.kind === "thread" ? current.thread.root.text : "" }
        : tweets[0]
          ? { handle: tweets[0].author.handle, text: tweets[0].text }
          : undefined;
      const res = await runDraftFn({
        data: {
          kind: isThread ? "reply" : "post",
          instruction: instruction || undefined,
          target,
          context: tweets.slice(0, 5).map((t) => ({ handle: t.author.handle, text: t.text })),
        },
      });
      if (res.ok) setDraft(res.draft.text);
      else toast.error(res.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">Brief</p>
        <h2 className="mt-1 text-base font-medium text-fg">What this slice is saying</h2>
        <p className="mt-1 text-sm text-muted">OpenRouter is already on. One click, no keys.</p>
      </div>
      <Button onClick={briefThis} disabled={briefing || tweets.length === 0} className="w-full">
        {briefing ? <LoaderCircle className="animate-spin" /> : <ScanSearch />}
        {briefing ? "Reading the room" : "Brief this"}
      </Button>
      {brief && (
        <div className="flex flex-col gap-3">
          <h3 className="text-pretty text-lg font-medium leading-snug text-fg">{brief.headline}</h3>
          <p className="text-pretty text-sm leading-relaxed text-muted">{brief.summary}</p>
          {brief.takeaways.length > 0 && (
            <ul className="flex flex-col gap-2">
              {brief.takeaways.map((t) => (
                <li key={t} className="flex gap-2 text-sm text-fg">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-fg/50" />
                  <span className="text-pretty leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
          )}
          {brief.notable && brief.notable.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
                Notable
              </p>
              <ul className="flex flex-col gap-1">
                {brief.notable.map((n) => (
                  <li key={n} className="text-sm text-muted">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="border-t border-border pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">Draft</p>
        <p className="mt-1 text-sm text-muted">
          Writes a post you can copy into X. Nothing is published from here.
        </p>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Optional angle — skeptical, punchy, dry…"
          className="mt-3 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-fg/15"
        />
        <Button variant="secondary" onClick={draftThis} disabled={drafting} className="mt-2 w-full">
          {drafting ? <LoaderCircle className="animate-spin" /> : null}
          {drafting ? "Drafting" : isThread ? "Draft a reply" : "Draft a post"}
        </Button>
        {draft && (
          <div className="mt-3 rounded-lg border border-border bg-bg p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{draft}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={async () => {
                await navigator.clipboard.writeText(draft);
                toast.success("Draft copied");
              }}
            >
              <Copy />
              Copy
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
