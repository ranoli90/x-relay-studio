import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden="true"
      fill="none"
    >
      <rect width="32" height="32" rx="8" className="fill-fg" />
      <path
        d="M9 9.2 14.7 16 9 22.8h3.1L16 17.7l3.9 5.1H23L17.3 16 23 9.2h-3.1L16 14.3 12.1 9.2H9Z"
        className="fill-bg"
      />
      <circle cx="24.2" cy="8.2" r="2.3" className="fill-bg" />
    </svg>
  );
}
