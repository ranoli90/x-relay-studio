import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-fg shadow-none outline-none placeholder:text-subtle transition-[border-color,box-shadow] duration-[var(--motion-quick)] focus:border-fg/30 focus:ring-2 focus:ring-fg/15",
        className,
      )}
      {...props}
    />
  );
}
