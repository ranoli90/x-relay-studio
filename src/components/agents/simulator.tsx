import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SCENARIOS, type ScenarioId } from "./model";

export function InboundSimulator({
  value,
  onChange,
  busy,
  onSend,
  onScenario,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  onScenario: (id: ScenarioId) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border p-3">
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">Inbound simulator</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Isolated fixture. Preview a fan without live Telegram.
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            onClick={() => onScenario(s.id)}
            className="h-11 min-h-[44px] rounded-md border border-border px-3 text-xs text-muted transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40 disabled:opacity-40"
          >
            {s.label}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Fan says…"
          className="h-11 min-h-[44px] min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm outline-none transition-[border-color,box-shadow] duration-[var(--motion-quick)] focus:ring-2 focus:ring-fg/30"
        />
        <Button type="submit" size="icon" disabled={busy || !value.trim()} aria-label="Simulate inbound">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
