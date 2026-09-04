import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-12 w-full rounded-lg border border-border bg-surface px-4 text-base text-fg shadow-none outline-none placeholder:text-subtle transition-[border-color,box-shadow] duration-[var(--motion-quick)] focus:border-fg/30 focus:ring-2 focus:ring-fg/15",
        className,
      )}
      {...props}
    />
  );
}
