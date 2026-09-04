import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCount(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (abs < 1_000_000) return `${Math.round(n / 1000)}K`;
  if (abs < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(n / 1_000_000)}M`;
}
