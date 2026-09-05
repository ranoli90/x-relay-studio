import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TelegramAccount } from "@/lib/telegram/types";
import { BIO_GRAPHEME_LIMIT } from "@/lib/telegram/types";
import { graphemeCount, sliceGraphemes } from "@/lib/telegram/graphemes";

export function ProfileEdit({
  account,
  saving,
  onBack,
  onSave,
}: {
  account: TelegramAccount;
  saving: boolean;
  onBack: () => void;
  onSave: (input: { firstName: string; lastName: string; about: string }) => void;
}) {
  const [firstName, setFirstName] = useState(account.displayFirstName);
  const [lastName, setLastName] = useState(account.displayLastName ?? "");
  const [about, setAbout] = useState(account.replicaAbout ?? "");
  const used = graphemeCount(about);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        <button type="button" onClick={onBack} className="grid size-11 place-items-center" aria-label="Back">
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="text-sm font-medium">Edit profile</h2>
      </header>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ firstName, lastName, about });
        }}
      >
        <label className="grid gap-1.5 text-xs text-[var(--tg-text-secondary)]">
          First name
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={64}
            className="bg-[var(--tg-item-hover)] text-[var(--tg-text)]"
          />
        </label>
        <label className="grid gap-1.5 text-xs text-[var(--tg-text-secondary)]">
          Last name
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={64}
            className="bg-[var(--tg-item-hover)] text-[var(--tg-text)]"
          />
        </label>
        <label className="grid gap-1.5 text-xs text-[var(--tg-text-secondary)]">
          Bio
          <Textarea
            value={about}
            onChange={(e) => setAbout(sliceGraphemes(e.target.value, BIO_GRAPHEME_LIMIT))}
            rows={4}
            className="bg-[var(--tg-item-hover)] text-[var(--tg-text)]"
          />
          <span className="text-right font-mono">
            {used}/{BIO_GRAPHEME_LIMIT}
          </span>
        </label>
        <p className="text-xs leading-relaxed text-[var(--tg-text-secondary)]">
          Saved in this studio. Your Telegram profile was not changed.
        </p>
        <Button type="submit" className="mt-auto h-12 w-full justify-center" disabled={saving || !firstName.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </div>
  );
}
