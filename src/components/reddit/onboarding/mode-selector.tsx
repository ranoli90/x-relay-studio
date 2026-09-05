import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ModeSelector({
  assistedAvailable,
  assistedReason,
  selected,
  onSelect,
  onExisting,
}: {
  assistedAvailable: boolean;
  assistedReason: string | null;
  selected: "assisted" | "manual" | null;
  onSelect: (mode: "assisted" | "manual") => void;
  onExisting: () => void;
}) {
  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Account → App access → Connect</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">Add a Reddit account</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Create an account with guided help, or complete signup yourself. You can connect an existing
        account instead.
      </p>

      <div role="radiogroup" aria-label="How do you want to add a Reddit account?" className="mt-8 grid gap-3">
        <ModeCard
          id="mode-assisted"
          title="Automate account creation"
          description="We handle supported steps. You stay in control of verification and final approval."
          selected={selected === "assisted"}
          disabled={!assistedAvailable}
          disabledReason={assistedReason}
          onSelect={() => onSelect("assisted")}
        />
        <ModeCard
          id="mode-manual"
          title="Manual"
          description="Open Reddit, create your account, then return to connect it."
          selected={selected === "manual"}
          onSelect={() => onSelect("manual")}
        />
      </div>

      <Button type="button" variant="ghost" className="mt-6 w-full" onClick={onExisting}>
        I already have a Reddit account
      </Button>
    </section>
  );
}

function ModeCard({
  id,
  title,
  description,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: {
  id: string;
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onSelect: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-4 text-left transition-colors",
        selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <p className="text-base font-medium tracking-tight">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
      {disabled && disabledReason ? (
        <p className="mt-2 text-xs leading-relaxed text-warn">{disabledReason}</p>
      ) : null}
    </button>
  );
}
