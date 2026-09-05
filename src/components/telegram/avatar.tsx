import { cn } from "@/lib/utils";
import { initials } from "./format";

export function TgAvatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "size-10" : size === "lg" ? "size-24" : "size-12";
  const text = size === "lg" ? "text-2xl" : "text-sm";
  if (src) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(dim, "shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10")}
      />
    );
  }
  return (
    <span
      className={cn(
        dim,
        text,
        "grid shrink-0 place-items-center rounded-full bg-[var(--tg-primary)] font-medium text-white",
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
