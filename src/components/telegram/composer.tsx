import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TelegramChatKind } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";

export function Composer({
  disabled,
  kind,
  onSend,
}: {
  disabled: boolean;
  kind: TelegramChatKind;
  onSend: (body: string) => void;
}) {
  const [value, setValue] = useState("");
  const [vv, setVv] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

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

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    if (area.current) area.current.style.height = "auto";
  }

  const placeholder = "Message";

  return (
    <form
      className="shrink-0 border-t border-white/5 bg-[var(--tg-bg-secondary)] px-3 pt-2"
      style={{
        paddingBottom:
          vv > 0 ? `${vv + 8}px` : "max(0.5rem, env(safe-area-inset-bottom))",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={area}
          value={value}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="max-h-32 min-h-11 w-full resize-none rounded-xl bg-[var(--tg-item-hover)] px-3 py-2.5 text-base text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-secondary)] disabled:opacity-50"
          enterKeyHint="send"
          onChange={(e) => {
            setValue(e.target.value);
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
          disabled={disabled || !value.trim()}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full bg-[var(--tg-primary)] text-[var(--tg-own-text)]",
            "disabled:opacity-40",
          )}
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
    </form>
  );
}
