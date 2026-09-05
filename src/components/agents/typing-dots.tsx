import { cn } from "@/lib/utils";

export function TypingDots({ className, label = "Typing" }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="floor-typing-dot size-1.5 rounded-full bg-current" />
        <span className="floor-typing-dot size-1.5 rounded-full bg-current" />
        <span className="floor-typing-dot size-1.5 rounded-full bg-current" />
      </span>
    </span>
  );
}
