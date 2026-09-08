import { Briefcase, ImageIcon, MessageCircle, Settings } from "lucide-react";
import type { ShellTab } from "@/lib/telegram/store";
import { cn } from "@/lib/utils";
import { tgFocusClass } from "./format";

const TABS: { id: ShellTab; label: string; icon: typeof MessageCircle }[] = [
  { id: "inbox", label: "Inbox", icon: MessageCircle },
  { id: "business", label: "Business", icon: Briefcase },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "settings", label: "Settings", icon: Settings },
];

export function OperatorNav({
  tab,
  onTab,
}: {
  tab: ShellTab;
  onTab: (tab: ShellTab) => void;
}) {
  return (
    <nav
      aria-label="Studio"
      className="flex shrink-0 border-t border-white/5 bg-[var(--tg-bg-secondary)] [padding-bottom:env(safe-area-inset-bottom)]"
    >
      {TABS.map((item) => {
        const Icon = item.icon;
        const on = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[length:var(--tg-fs-micro)]",
              on ? "text-[var(--tg-primary)]" : "text-[var(--tg-text-secondary)]",
              tgFocusClass,
            )}
          >
            <Icon className="size-5" aria-hidden />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
