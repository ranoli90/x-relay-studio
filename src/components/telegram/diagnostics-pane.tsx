import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { tgFocusClass } from "./format";

export function DiagnosticsPane() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center px-4">
        <h2 className="text-sm font-medium">Diagnostics</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <p className="text-sm leading-relaxed text-[var(--tg-text-secondary)]">
          Isolated test lab. Fixture chats are harmless and are not production customers. Simulator
          controls stay here, not on Inbox.
        </p>
        <Link
          to="/agents"
          className={cn(
            "mt-4 flex h-12 min-h-[44px] items-center rounded-xl bg-[var(--tg-item-hover)] px-4 text-sm",
            tgFocusClass,
          )}
        >
          Open test lab floor
        </Link>
        <p className="mt-3 text-xs leading-relaxed text-[var(--tg-text-secondary)]">
          Routing scores, fixture inbound, and synthetic payment evidence belong on that floor.
          Live Telegram sending is off in this environment.
        </p>
      </div>
    </div>
  );
}
