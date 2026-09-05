import { cn } from "@/lib/utils";

export function FloorSwitch({
  label,
  checked,
  disabled,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-11 min-h-[44px] shrink-0 items-center gap-2 rounded-md px-2",
        "transition-[background-color,opacity] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
        "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "active:not-disabled:scale-[0.96]",
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)]",
          checked ? "bg-up" : "bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-fg transition-transform duration-[var(--motion-quick)] ease-[var(--ease-out)]",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
