import { Check, Image as ImageIcon, LoaderCircle, RotateCcw, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseHandles } from "@/lib/studio/handles";
import type { SourceRow } from "@/lib/studio/types";
import { cn, formatCount } from "@/lib/utils";
import { useStudio } from "@/store/studio";

export function SourceWorkspace() {
  const publishers = useStudio((s) => s.publishers);
  const selectedPublisherId = useStudio((s) => s.selectedPublisherId);
  const sources = useStudio((s) => s.sources);
  const filter = useStudio((s) => s.filter);
  const setFilter = useStudio((s) => s.setFilter);
  const selectedIds = useStudio((s) => s.selectedIds);
  const selectedSourceId = useStudio((s) => s.selectedSourceId);
  const adding = useStudio((s) => s.adding);
  const addHandles = useStudio((s) => s.addHandles);
  const removeSelected = useStudio((s) => s.removeSelected);
  const moveSelected = useStudio((s) => s.moveSelected);
  const clearSelected = useStudio((s) => s.clearSelected);
  const selectAllVisible = useStudio((s) => s.selectAllVisible);
  const [draft, setDraft] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pulling" | "live" | "error">("all");
  const retryErrors = useStudio((s) => s.retryErrors);

  const publisher = publishers.find((p) => p.id === selectedPublisherId) ?? publishers[0];
  const mine = useMemo(
    () => sources.filter((s) => s.publisherId === publisher?.id),
    [sources, publisher?.id],
  );
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^@/, "");
    let rows = mine;
    if (statusFilter === "pulling") rows = rows.filter((s) => s.status === "pending" || s.status === "syncing" || s.status === "rewriting");
    else if (statusFilter === "live") rows = rows.filter((s) => s.status === "ready");
    else if (statusFilter === "error") rows = rows.filter((s) => s.status === "error");
    if (!q) return rows;
    return rows.filter(
      (s) => s.handle.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }, [mine, filter, statusFilter]);

  const parsed = parseHandles(draft);
  const pulling = mine.filter((s) => s.status === "pending" || s.status === "syncing").length;
  const rewriting = mine.filter((s) => s.status === "rewriting").length;
  const monitoring = mine.filter((s) => s.status === "ready").length;
  const errors = mine.filter((s) => s.status === "error").length;
  const stored = mine.reduce((n, s) => n + s.tweetsSynced, 0);
  const rewritten = mine.reduce((n, s) => n + s.rewritten, 0);

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!parsed.length) return;
    void addHandles(parsed).then(() => setDraft(""));
  }

  if (!publisher) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Sources for</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">@{publisher.handle}</h1>
            <p className="mt-1 text-sm text-muted">
              Paste any number of handles. We take each full archive — walking
              from recent posts back to the first — save every post and image URL,
              rewrite the set, then keep monitoring. Stop or close the tab and we
              resume; we never start over.
            </p>
          </div>
          <p className="font-mono text-xs tabular-nums text-subtle">
            {mine.length} assigned
            {pulling > 0 && ` · ${pulling} pulling`}
            {rewriting > 0 && ` · ${rewriting} rewrite`}
            {monitoring > 0 && ` · ${monitoring} live`}
            {stored > 0 && ` · ${formatCount(stored)} stored`}
            {rewritten > 0 && ` · ${formatCount(rewritten)} ready`}
          </p>
        </div>

        {(mine.length === 0 || composerOpen) ? (
        <form onSubmit={onAdd} className="mt-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"@naval\nhttps://x.com/paulg\nsama, karpathy"}
            className="min-h-24 font-mono text-sm"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onAdd(e);
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={adding || parsed.length === 0}>
              {adding ? "Adding…" : parsed.length ? `Add ${parsed.length}` : "Add accounts"}
            </Button>
            {mine.length > 0 && (
              <button type="button" className="h-11 text-xs text-muted hover:text-fg" onClick={() => setComposerOpen(false)}>
                Hide
              </button>
            )}
            <p className="text-xs text-subtle">
              {parsed.length
                ? `${parsed.length} unique handle${parsed.length === 1 ? "" : "s"} · Enter+${typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"} to submit`
                : "Newlines, commas, or profile links. Duplicates skipped."}
            </p>
          </div>
        </form>
        ) : (
          <button
            type="button"
            className="mt-4 inline-flex h-11 items-center text-sm text-muted hover:text-fg"
            onClick={() => setComposerOpen(true)}
          >
            Add more accounts
          </button>
        )}
      </div>

      {mine.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-6">
          <Search className="size-4 text-subtle" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${mine.length} accounts`}
            className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus:ring-0"
          />
          {(
            [
              ["all", "All"],
              ["pulling", "Pulling"],
              ["live", "Live"],
              ["error", "Error"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={cn(
                "h-10 rounded-full px-3 text-xs",
                statusFilter === id ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {label}
              {id === "error" && errors > 0 ? ` ${errors}` : ""}
            </button>
          ))}
          {errors > 0 && (
            <button type="button" className="h-10 text-xs text-down hover:underline" onClick={() => void retryErrors()}>
              Resume all
            </button>
          )}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 sm:px-6">
          <p className="text-sm text-fg">{selectedIds.length} selected</p>
          <Button size="sm" variant="secondary" onClick={() => void removeSelected()}>
            Remove
          </Button>
          {publishers.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Move to
              <select
                className="h-9 rounded-md border border-border bg-bg px-2 text-fg"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void moveSelected(e.target.value);
                }}
              >
                <option value="" disabled>
                  posting account
                </option>
                {publishers
                  .filter((p) => p.id !== publisher.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      @{p.handle}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button type="button" className="ml-auto text-sm text-muted hover:text-fg" onClick={clearSelected}>
            Clear
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mine.length === 0 ? (
          <div className="px-4 py-16 text-center sm:px-6">
            <p className="text-sm text-muted">
              Nothing assigned yet. Paste 1 or 100 handles above — same action.
            </p>
          </div>
        ) : (
          <ul>
            <li className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-subtle sm:px-6">
              <input
                type="checkbox"
                className="size-4 accent-fg"
                checked={visible.length > 0 && visible.every((s) => selectedIds.includes(s.id))}
                onChange={(e) => {
                  if (e.target.checked) selectAllVisible(visible.map((s) => s.id));
                  else clearSelected();
                }}
                aria-label="Select all visible"
              />
              <span className="flex-1">Account</span>
              <span className="hidden w-40 sm:block">Archive</span>
              <span className="w-28 text-right">Status</span>
            </li>
            {visible.map((source) => (
              <SourceRowItem
                key={source.id}
                source={source}
                selected={selectedIds.includes(source.id)}
                active={source.id === selectedSourceId}
              />
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">No matches.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function SourceRowItem({
  source,
  selected,
  active,
}: {
  source: SourceRow;
  selected: boolean;
  active: boolean;
}) {
  const toggleSelected = useStudio((s) => s.toggleSelected);
  const selectSource = useStudio((s) => s.selectSource);
  const retry = useStudio((s) => s.retry);

  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b border-border px-4 py-2.5 transition-[background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)] sm:px-6",
        active && "bg-surface",
      )}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-fg"
        checked={selected}
        onChange={() => toggleSelected(source.id)}
        aria-label={`Select @${source.handle}`}
      />
      <button
        type="button"
        onClick={() => selectSource(source.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="size-9 shrink-0 overflow-hidden rounded-full bg-surface-2">
          {source.avatar ? (
            <img
              src={source.avatar}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-xs text-muted">
              {source.handle.slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{source.name}</span>
          <span className="block truncate font-mono text-xs text-muted">@{source.handle}</span>
        </span>
        <span className="hidden w-40 shrink-0 font-mono text-xs tabular-nums text-subtle sm:block">
          {formatCount(source.tweetsSynced)}
          {source.tweetsClaimed > 0 && (
            <span> / {formatCount(source.tweetsClaimed)}</span>
          )}
          <span className="mt-0.5 flex items-center gap-1">
            <ImageIcon className="size-3" />
            {formatCount(source.mediaSynced)}
          </span>
        </span>
      </button>
      <span className="w-28 shrink-0 text-right">
        <StatusChip source={source} onRetry={() => void retry(source.id)} />
      </span>
    </li>
  );
}

function StatusChip({ source, onRetry }: { source: SourceRow; onRetry: () => void }) {
  if (source.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs text-up">
        <Check className="size-3.5" />
        Monitoring
      </span>
    );
  }
  if (source.status === "error") {
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-mono text-xs text-down">
        <RotateCcw className="size-3.5" />
        Resume
      </button>
    );
  }
  const label =
    source.status === "rewriting"
      ? `${formatCount(source.rewritten)}/${formatCount(source.tweetsSynced)}`
      : source.status === "syncing"
        ? `Stored ${formatCount(source.tweetsSynced)}`
        : "Queued";
  return (
    <span className="inline-flex items-center justify-end gap-1 font-mono text-xs text-muted">
      <LoaderCircle className="size-3.5 animate-spin" />
      {label}
    </span>
  );
}
