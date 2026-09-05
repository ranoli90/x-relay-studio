import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TelegramPlaceholder() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Telegram</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Not open yet.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          This door is reserved for a later Telegram tool. No accounts, no
          queue, no send. Use X for now.
        </p>
        <img
          src="/telegram-mark.jpg"
          alt=""
          width={96}
          height={96}
          className="mt-8 size-24 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-fg/10"
        />
        <div className="mt-8 grid gap-3">
          <Link
            to="/x"
            className={cn(buttonVariants({ size: "lg" }), "h-12 w-full justify-center text-base")}
          >
            Open X
          </Link>
          <Link
            to="/"
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "h-12 w-full justify-center",
            )}
          >
            Back to platforms
          </Link>
        </div>
      </div>
    </main>
  );
}
