import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-10 flex flex-wrap gap-x-4 gap-y-2 text-xs text-subtle">
      <Link to="/privacy" className="hover:text-fg">
        Privacy
      </Link>
      <Link to="/terms" className="hover:text-fg">
        Terms
      </Link>
      <span>Independent of X, Telegram, and Reddit.</span>
    </footer>
  );
}
