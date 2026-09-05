import { useState } from "react";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (body: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  return (
    <form
      className="shrink-0 border-t border-white/5 bg-[var(--tg-bg-secondary)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={value}
        disabled={disabled}
        rows={1}
        placeholder={disabled ? "This chat is read-only on this path." : "Message"}
        className="max-h-32 min-h-11 w-full resize-none rounded-xl bg-[var(--tg-item-hover)] px-3 py-2.5 text-[16px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-secondary)] disabled:opacity-50"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
    </form>
  );
}
