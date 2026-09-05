import { useRouter } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Opaque slide-over. The screen underneath stays mounted, but this layer is
 * fully painted — never transparent — so navigation cannot flash the wrong
 * view through an incoming fade.
 */
export function PushScreen({
  open,
  children,
  className,
  z = 10,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  z?: number;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "absolute inset-0 overflow-hidden bg-bg will-change-transform",
        "transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)]",
        "motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
        className,
      )}
      style={{ zIndex: z }}
    >
      {children}
    </div>
  );
}

export function DoorSkeleton() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">X Relay</p>
        <div className="skeleton-shimmer mt-4 h-8 w-56 rounded-md" />
        <div className="skeleton-shimmer mt-4 h-20 w-full rounded-md" />
      </div>
    </main>
  );
}

function veilEl() {
  return document.getElementById("nav-veil");
}

function armVeil() {
  const el = veilEl();
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("pointer-events-none");
}

function lockVeil() {
  const el = veilEl();
  if (!el) return;
  el.classList.remove("hidden", "pointer-events-none");
}

function disarmVeil() {
  const el = veilEl();
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("pointer-events-none");
}

function isInternalPathClick(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const a = (event.target as HTMLElement | null)?.closest("a");
  if (!a) return false;
  if (a.target && a.target !== "_self") return false;
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return false;
  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== window.location.pathname;
}

/** Covers the previous route the moment an in-app path change starts. */
export function NavVeil() {
  const router = useRouter();

  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      window.clearTimeout(timer);
      disarmVeil();
    };
    const cover = (lock: boolean) => {
      if (lock) lockVeil();
      else armVeil();
      window.clearTimeout(timer);
      timer = window.setTimeout(stop, 900);
    };
    const onClick = (event: MouseEvent) => {
      if (isInternalPathClick(event)) cover(false);
    };
    document.addEventListener("click", onClick, true);
    const unsubStart = router.subscribe("onBeforeNavigate", (event) => {
      if (!event.pathChanged || !event.fromLocation) return;
      cover(true);
    });
    const unsubEnd = router.subscribe("onRendered", stop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.clearTimeout(timer);
      unsubStart();
      unsubEnd();
      disarmVeil();
    };
  }, [router]);

  return (
    <div id="nav-veil" className="fixed inset-0 z-[80] hidden bg-bg" aria-hidden="true">
      <DoorSkeleton />
    </div>
  );
}
