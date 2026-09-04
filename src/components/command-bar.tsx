import { ArrowRight, LoaderCircle } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchProduct } from "@/lib/x/types";
import { cn } from "@/lib/utils";
import { useRelay } from "@/store/relay";

const PRODUCTS: SearchProduct[] = ["Top", "Latest", "Media", "People"];

const MIN_FAVES = [
  { label: "Any", value: 0 },
  { label: "100+", value: 100 },
  { label: "1K+", value: 1000 },
  { label: "10K+", value: 10000 },
];

export function CommandBar({
  compact,
  onSubmit,
}: {
  compact?: boolean;
  onSubmit: (q: string) => void;
}) {
  const query = useRelay((s) => s.query);
  const setQuery = useRelay((s) => s.setQuery);
  const product = useRelay((s) => s.product);
  const setProduct = useRelay((s) => s.setProduct);
  const minFaves = useRelay((s) => s.minFaves);
  const setMinFaves = useRelay((s) => s.setMinFaves);
  const loading = useRelay((s) => s.loading);
  const recent = useRelay((s) => s.recent);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(query);
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search X, paste a post, or type @handle"
            autoComplete="off"
            spellCheck={false}
            className={cn("pr-12", compact ? "h-11" : "h-12 text-[15px]")}
            aria-label="Search X"
          />
          <Button
            type="submit"
            size="icon"
            className="absolute right-1 top-1/2 size-10 -translate-y-1/2 rounded-md"
            disabled={loading || !query.trim()}
            aria-label="Run search"
          >
            {loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
          </Button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-border bg-surface p-0.5">
          {PRODUCTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProduct(p)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                product === p ? "bg-fg text-bg" : "text-muted hover:text-fg",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-border bg-surface p-0.5">
          {MIN_FAVES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMinFaves(opt.value)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                minFaves === opt.value ? "bg-fg text-bg" : "text-muted hover:text-fg",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {!compact && recent.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {recent.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setQuery(r);
                onSubmit(r);
              }}
              className="max-w-full truncate rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:text-fg"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
