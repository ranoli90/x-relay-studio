import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { openDesk } from "@/lib/desk/server";
import { publicDeskError } from "@/lib/desk/public-error";
import {
  deskEmail,
  formatDeskNumber,
  generateDeskNumber,
  isDeskNumber,
  normalizeDeskNumber,
} from "@/lib/desk/number";

export function AnonymousDesk({
  onReady,
  onBegin,
}: {
  onReady: (deskNumber: string) => void;
  onBegin?: () => void;
}) {
  const [mode, setMode] = useState<"home" | "created" | "return">("home");
  const [number, setNumber] = useState("");
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    onBegin?.();
    setBusy(true);
    setError(null);
    const deskNumber = generateDeskNumber();
    let minted = false;
    try {
      const email = deskEmail(deskNumber);
      const { error: signError } = await authClient.signUp.email({
        email,
        password: deskNumber,
        name: "Desk",
      });
      if (signError) throw new Error(signError.message ?? "Could not open a desk.");
      minted = true;
      setNumber(deskNumber);
      await authClient.getSession();
      const desk = await openDesk({ data: { deskNumber } });
      setNumber(desk.deskNumber);
      setMode("created");
    } catch (e) {
      if (minted) {
        setNumber(deskNumber);
        setMode("created");
      }
      setError(publicDeskError(e, "Could not open a desk."));
    } finally {
      setBusy(false);
    }
  }

  async function comeBack() {
    setBusy(true);
    setError(null);
    try {
      const deskNumber = normalizeDeskNumber(typed);
      if (!isDeskNumber(deskNumber)) {
        throw new Error("A desk number is 16 digits.");
      }
      onBegin?.();
      const { error: signError } = await authClient.signIn.email({
        email: deskEmail(deskNumber),
        password: deskNumber,
      });
      if (signError) throw new Error("No desk with that number.");
      await authClient.getSession();
      const desk = await openDesk({ data: { deskNumber } });
      onReady(desk.deskNumber);
    } catch (e) {
      setError(publicDeskError(e, "Could not return."));
    } finally {
      setBusy(false);
    }
  }

  async function copyNumber(value: string) {
    await navigator.clipboard.writeText(formatDeskNumber(value));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">
          X Relay
        </p>

        {mode === "home" ? (
          <>
            <h1 className="mt-3 text-3xl font-medium tracking-tight">
              Open an anonymous desk.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              No name. No email. No Google. No X. We give you a 16-digit number
              — the same idea as Mullvad. That number is the only account we
              keep. Then you pick X, Telegram, or Reddit.
            </p>
            {error ? <p className="mt-4 text-sm text-down">{error}</p> : null}
            <div className="mt-8 grid gap-3">
              <Button
                size="lg"
                className="h-12 w-full"
                disabled={busy}
                onClick={() => void create()}
              >
                {busy ? "Opening…" : "Open a desk"}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="h-12 w-full"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode("return");
                }}
              >
                I already have a number
              </Button>
            </div>
            <p className="mt-8 text-xs leading-relaxed text-subtle">
              If you lose the number, the desk is gone. We cannot restore it.
              Save it like a key.
            </p>
          </>
        ) : null}

        {mode === "created" ? (
          <>
            <h1 className="mt-3 text-3xl font-medium tracking-tight">
              This is your desk. Save it now.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              We do not have an email for you. This number is the only way back.
            </p>
            <div className="mt-6 rounded-xl border border-border bg-surface p-5">
              <p className="font-mono text-[11px] uppercase tracking-widest text-subtle">
                Desk number
              </p>
              <p className="mt-3 font-mono text-2xl tracking-wide text-fg">
                {formatDeskNumber(number)}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                type="button"
                onClick={() => void copyNumber(number)}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-fg"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
              />
              I saved this number. There is no reset.
            </label>
            <Button
              size="lg"
              className="mt-6 h-12 w-full"
              disabled={!saved}
              onClick={() => onReady(number)}
            >
              Continue to platforms
            </Button>
          </>
        ) : null}

        {mode === "return" ? (
          <>
            <h1 className="mt-3 text-3xl font-medium tracking-tight">
              Enter your desk number.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              16 digits. Spaces are fine.
            </p>
            <Input
              className="mt-6 font-mono tracking-wide"
              inputMode="numeric"
              autoComplete="username"
              placeholder="0000 0000 0000 0000"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            {error ? <p className="mt-4 text-sm text-down">{error}</p> : null}
            <Button
              size="lg"
              className="mt-6 h-12 w-full"
              disabled={busy}
              onClick={() => void comeBack()}
            >
              {busy ? "Checking…" : "Return to desk"}
            </Button>
            <button
              type="button"
              className="mt-4 text-xs text-subtle hover:text-fg"
              onClick={() => {
                setError(null);
                setMode("home");
              }}
            >
              Open a new desk instead
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}

export function BindDesk({
  onReady,
}: {
  onReady: (deskNumber: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  if (number) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
        <div className="w-full max-w-md">
          <Logo />
          <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">X Relay</p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight">This is your desk. Save it now.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            We do not store a name or email as who you are. This number is what the desk shows.
          </p>
          <div className="mt-6 rounded-xl border border-border bg-surface p-5">
            <p className="font-mono text-[11px] uppercase tracking-widest text-subtle">Desk number</p>
            <p className="mt-3 font-mono text-2xl tracking-wide text-fg">{formatDeskNumber(number)}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(formatDeskNumber(number)).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm text-muted">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-fg"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            I saved this number.
          </label>
          <Button size="lg" className="mt-6 h-12 w-full" disabled={!saved} onClick={() => onReady(number)}>
            Continue to platforms
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">X Relay</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">This is your account with us.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          No name. No email. A 16-digit number is the only identity we keep.
          After this you pick X, Telegram, or Reddit.
        </p>
        {error ? <p className="mt-4 text-sm text-down">{error}</p> : null}
        <Button
          size="lg"
          className="mt-8 h-12 w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void openDesk({ data: {} })
              .then((d) => setNumber(d.deskNumber))
              .catch((e) => {
                setError(publicDeskError(e, "Could not open a desk."));
                setBusy(false);
              });
          }}
        >
          {busy ? "Opening…" : "Open a desk"}
        </Button>
      </div>
    </main>
  );
}
