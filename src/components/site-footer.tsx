import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-10 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
      <Link to="/privacy" className="hover:text-fg focus-visible:underline">
        Privacy
      </Link>
      <Link to="/terms" className="hover:text-fg focus-visible:underline">
        Terms
      </Link>
      <Link to="/status" className="hover:text-fg focus-visible:underline">
        Status
      </Link>
      <span>Independent of X, Telegram, and Reddit. We do not have an account — you attach yours.</span>
    </footer>
  );
}
