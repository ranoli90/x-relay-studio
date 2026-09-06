import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EmailBindingPublic } from "@/lib/reddit/onboarding/types";

export function EmailBindingPanel({
  bindings = [],
  busy,
  error,
  managedAvailable = false,
  onCreate,
  onDelete,
}: {
  bindings?: EmailBindingPublic[];
  busy?: boolean;
  error?: string | null;
  managedAvailable?: boolean;
  onCreate?: (input: { address: string; kind: "existing_inbox" }) => void;
  onDelete?: (bindingId: string) => void;
}) {
  const [address, setAddress] = useState("");

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Recovery email</p>
      <h2 className="mt-2 text-lg font-medium tracking-tight">Use an inbox you already control</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This is an explicit settings step. Loading this page does not create a mailbox. A created
        mailbox is not proof that Reddit verified the address.
      </p>

      <label className="mt-4 block text-sm">
        Existing durable address
        <Input
          className="mt-2"
          type="email"
          autoComplete="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <Button
        type="button"
        className="mt-3 w-full"
        disabled={busy || !address.trim()}
        onClick={() => {
          onCreate?.({ address: address.trim(), kind: "existing_inbox" });
          setAddress("");
        }}
      >
        {busy ? "Saving…" : "Save recovery email"}
      </Button>
      {!managedAvailable ? (
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          A managed alias or inbox needs an explicit provider and domain. Until those exist, keep
          using your own address.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}

      <ul className="mt-4 space-y-2">
        {bindings.map((binding) => (
          <li key={binding.id} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <p className="font-medium">{binding.maskedDisplay}</p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-subtle">
              {binding.kind} · {binding.status}
              {binding.destinationVerified ? " · destination verified" : ""}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 px-0"
              disabled={busy}
              onClick={() => onDelete?.(binding.id)}
            >
              Delete this binding
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
