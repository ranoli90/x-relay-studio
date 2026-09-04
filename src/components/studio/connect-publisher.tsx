import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupHandleFn } from "@/lib/studio/fns";
import { guessHandle, parseHandles } from "@/lib/studio/handles";
import type { LookupProfile } from "@/lib/studio/types";
import { formatCount } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useStudio } from "@/store/studio";

export function ConnectPublisher({ compact = false }: { compact?: boolean }) {
  const user = useCurrentUser();
  const connect = useStudio((s) => s.connect);
  const [handle, setHandle] = useState(() => guessHandle(user?.displayName ?? null, user?.primaryEmail ?? null));
  const [preview, setPreview] = useState<LookupProfile | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e?: FormEvent) {
    e?.preventDefault();
    const parsed = parseHandles(handle)[0];
    if (!parsed) {
      setError("Type an @handle — no password.");
      return;
    }
    setLooking(true);
    setError(null);
    setPreview(null);
    try {
      const profile = await lookupHandleFn({ data: { handle: parsed } });
      if (!profile) setError(`No public profile for @${parsed}.`);
      else {
        setPreview(profile);
        setHandle(profile.handle);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLooking(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setSaving(true);
    const pub = await connect(preview.handle);
    setSaving(false);
    if (!pub) setError("Could not save that posting account.");
  }

  return (
    <section className={compact ? "" : "mx-auto w-full max-w-lg py-10"}>
      {!compact && (
        <>
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">Posting account</p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight">Who are we posting as?</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Type the X handle. We pull the public profile so you can confirm it’s the
            right one — no password, no app keys. Source accounts get assigned to this
            next, in bulk.
          </p>
        </>
      )}

      <form onSubmit={lookup} className={compact ? "flex gap-2" : "mt-8 flex gap-2"}>
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-muted">
            @
          </span>
          <Input
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value.replace(/^@/, ""));
              setPreview(null);
            }}
            placeholder="handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="pl-8"
            aria-label="X handle"
          />
        </div>
        <Button type="submit" variant={preview ? "secondary" : "default"} disabled={looking}>
          {looking ? <LoaderCircle className="size-4 animate-spin" /> : "Look up"}
        </Button>
      </form>

      {error && <p className="mt-3 text-sm text-down">{error}</p>}

      {preview && (
        <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
          {preview.banner && (
            <img src={preview.banner} alt="" className="h-24 w-full object-cover" referrerPolicy="no-referrer" />
          )}
          <div className="p-4">
            <div className="flex items-center gap-3">
              <span className="size-14 overflow-hidden rounded-full bg-surface-2">
                {preview.avatar && (
                  <img src={preview.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{preview.name}</p>
                <p className="font-mono text-sm text-muted">@{preview.handle}</p>
              </div>
            </div>
            {preview.bio && <p className="mt-3 line-clamp-3 text-sm text-muted">{preview.bio}</p>}
            <p className="mt-3 font-mono text-xs tabular-nums text-subtle">
              {formatCount(preview.followers)} followers · {formatCount(preview.tweets)} posts
            </p>
            <Button className="mt-4 w-full" disabled={saving} onClick={() => void confirm()}>
              {saving ? "Saving…" : `Post as @${preview.handle}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
