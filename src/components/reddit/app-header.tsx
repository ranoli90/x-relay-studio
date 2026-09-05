import { Link } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between border-b border-line px-4 py-3">
      <div>
        <p className="font-mono text-[11px] tracking-[0.2em] text-muted uppercase">
          Reddit
        </p>
        <Link
          to="/"
          className="text-xs text-subtle transition-colors duration-[var(--motion-quick)] hover:text-fg"
        >
          All platforms
        </Link>
      </div>
      <UserButton />
    </header>
  );
}
