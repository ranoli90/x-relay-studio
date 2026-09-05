import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TelegramChatKind } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";
import { tgFocusClass } from "./format";

export function Composer({
  disabled,
  kind,
  draft,
  onDraft,
  onSend,
}: {
  disabled: boolean;
  kind: TelegramChatKind;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (body: string) => void | Promise<boolean | void>;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [vv, setVv] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setVv(offset);
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
    };
  }, []);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    void onSend(text);
  }

  return (
    <form
      className="min-w-0 shrink-0 overflow-x-hidden border-t border-white/5 bg-[var(--tg-bg-secondary)] px-3 pt-2"
      style={{
        paddingBottom:
          vv > 0 ? `${vv + 8}px` : "max(0.5rem, env(safe-area-inset-bottom))",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex min-w-0 items-end gap-2">
        <textarea
          ref={area}
          value={draft}
          disabled={disabled}
          rows={1}
          placeholder="Message"
          aria-label={kind === "notes" ? "Studio note" : "Message"}
          className={cn(
            "max-h-32 min-h-[44px] min-w-0 w-full resize-none rounded-xl bg-[var(--tg-item-hover)] px-3 py-2.5 text-base text-[var(--tg-text)] placeholder:text-[var(--tg-text-secondary)] disabled:opacity-50",
            tgFocusClass,
          )}
          enterKeyHint="send"
          autoComplete="off"
          onChange={(e) => {
            onDraft(e.target.value);
            e.currentTarget.style.height = "auto";
            e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 128)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className={cn(
            "grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full bg-[var(--tg-primary)] text-[var(--tg-own-text)]",
            "disabled:opacity-40",
            tgFocusClass,
          )}
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
    </form>
  );
}
