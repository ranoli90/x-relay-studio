import { Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseHandles } from "@/lib/studio/handles";
import type { OutboxItem } from "@/lib/studio/types";
import { formatCount } from "@/lib/utils";
import { useStudio } from "@/store/studio";

export function LiveView() {
  const publishers = useStudio((s) => s.publishers);
  const selectedPublisherId = useStudio((s) => s.selectedPublisherId);
  const publisher = publishers.find((p) => p.id === selectedPublisherId) ?? publishers[0];
  const watch = useStudio((s) => s.watch);
  const outbox = useStudio((s) => s.outbox);
  const dueCount = useStudio((s) => s.dueCount);
  const sentToday = useStudio((s) => s.sentToday);
  const liveLoading = useStudio((s) => s.liveLoading);
  const addWatch = useStudio((s) => s.addWatch);
  const removeWatch = useStudio((s) => s.removeWatch);
  const setDrip = useStudio((s) => s.setDrip);
  const markOutbox = useStudio((s) => s.markOutbox);
  const [draft, setDraft] = useState("");
  const parsed = parseHandles(draft);

  const due = useMemo(() => outbox.filter((o) => o.status === "due"), [outbox]);
  const recent = useMemo(() => outbox.filter((o) => o.status !== "due").slice(0, 12), [outbox]);

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!parsed.length) return;
    void addWatch(parsed).then(() => setDraft(""));
  }

  if (!publisher) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
      <section className="border-b border-border px-4 py-4 sm:px-6 lg:w-[22rem] lg:shrink-0 lg:border-b-0 lg:border-r">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Master watch list</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">Creators</h1>
        <p className="mt-1 text-sm text-muted">
          One list for every posting account. We check it around the clock, take a
          few safe new posts, and turn them into replies in @{publisher.handle}’s
          voice.
        </p>
        <form onSubmit={onAdd} className="mt-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"@naval\n@paulg\nhttps://x.com/sama"}
            className="min-h-24 font-mono text-sm"
          />
          <Button type="submit" className="mt-2" disabled={parsed.length === 0}>
            {parsed.length ? `Watch ${parsed.length}` : "Add creators"}
          </Button>
        </form>
        <ul className="mt-4 divide-y divide-border">
          {watch.length === 0 && (
            <li className="py-6 text-sm text-muted">Paste the big accounts once. We don’t change this per source.</li>
          )}
          {watch.map((w) => (
            <li key={w.id} className="flex items-center gap-3 py-2">
              <span className="size-8 overflow-hidden rounded-full bg-surface-2">
                {w.avatar ? (
                  <img src={w.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs">{w.handle.slice(0, 1).toUpperCase()}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{w.name}</span>
                <span className="block truncate font-mono text-xs text-muted">@{w.handle}</span>
              </span>
              <button
                type="button"
                className="size-11 text-subtle hover:text-down"
                onClick={() => void removeWatch([w.id])}
                aria-label={`Remove @${w.handle}`}
              >
                <Trash2 className="mx-auto size-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="min-w-0 flex-1 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Outbox for</p>
            <h2 className="mt-1 text-2xl font-medium tracking-tight">@{publisher.handle}</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              About 10 originals and 24 replies a day — not one post. Originals walk
              the scraped archive. Replies watch the master list. A matching photo
              URL from the scrape is attached when one fits. Drafts open on X;
              mark sent after they go up.
            </p>
          </div>
          <label className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-fg"
              checked={publisher.dripEnabled}
              onChange={(e) => void setDrip(publisher.id, e.target.checked)}
            />
            Auto on
          </label>
        </div>
        <p className="mt-3 font-mono text-xs tabular-nums text-subtle">
          {formatCount(dueCount)} due · {formatCount(sentToday)} sent today
          {liveLoading ? " · filling…" : ""}
        </p>

        <div className="mt-4 grid gap-3">
          {due.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
              {watch.length === 0
                ? "Add creators on the left, and assign a source so we have a voice and photos."
                : "Queue is filling. Originals need rewritten archive posts; replies need a new safe post on the watch list."}
            </p>
          )}
          {due.map((item) => (
            <OutboxCard key={item.id} item={item} onMark={markOutbox} />
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-8">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Recently cleared</p>
            <ul className="mt-2 grid gap-2">
              {recent.map((item) => (
                <li key={item.id} className="truncate text-sm text-muted">
                  <span className="font-mono text-xs text-subtle">{item.kind}</span>
                  {" · "}
                  {item.body}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function OutboxCard({
  item,
  onMark,
}: {
  item: OutboxItem;
  onMark: (ids: string[], status: "sent" | "skipped") => Promise<void>;
}) {
  const replyId = item.replyToUrl?.match(/(\d{6,20})(?:\?|$)/)?.[1];
  const intent = replyId
    ? `https://x.com/intent/tweet?in_reply_to=${replyId}&text=${encodeURIComponent(item.body)}`
    : `https://x.com/intent/tweet?text=${encodeURIComponent(item.body)}`;

  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-subtle">
        {item.kind === "reply" ? "Reply" : "Original"}
        <span className="normal-case tracking-normal text-muted">
          due {item.dueAt.slice(11, 16)} UTC
        </span>
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.body}</p>
      {item.mediaUrl && (
        <div className="mt-3 flex items-end gap-3">
          <img
            src={item.mediaUrl}
            alt=""
            className="h-24 w-24 rounded-md object-cover"
            referrerPolicy="no-referrer"
          />
          <p className="text-xs text-subtle">Matching photo from the scrape. Copy the URL and attach it on X.</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-10"
          onClick={async () => {
            await navigator.clipboard.writeText(item.body);
            toast.success("Text copied");
          }}
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
        {item.mediaUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={async () => {
              await navigator.clipboard.writeText(item.mediaUrl ?? "");
              toast.success("Image URL copied");
            }}
          >
            Photo URL
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-10"
          onClick={() => window.open(intent, "_blank", "noopener")}
        >
          <ExternalLink className="size-3.5" />
          Open draft
        </Button>
        <Button variant="ghost" size="sm" className="h-10" onClick={() => void onMark([item.id], "sent")}>
          <Check className="size-3.5" />
          Sent
        </Button>
        <button type="button" className="h-10 px-2 text-xs text-subtle hover:text-fg" onClick={() => void onMark([item.id], "skipped")}>
          Skip
        </button>
      </div>
    </article>
  );
}
