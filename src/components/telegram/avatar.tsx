import { useState } from "react";
import { cn } from "@/lib/utils";
import { initials } from "./format";

const PALETTE = [
  "#c4515b",
  "#d08c4a",
  "#5b8f4a",
  "#3d8a99",
  "#4a7bb0",
  "#7a63b5",
  "#b85a86",
  "#6b7280",
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length] ?? PALETTE[0];
}

function InitialsMark({
  name,
  dim,
  text,
}: {
  name: string;
  dim: string;
  text: string;
}) {
  return (
    <span
      className={cn(dim, text, "grid shrink-0 place-items-center rounded-full font-medium text-white")}
      style={{ backgroundColor: colorFor(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function TgAvatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [broken, setBroken] = useState(false);
  const dim = size === "sm" ? "size-10" : size === "lg" ? "size-24" : "size-12";
  const text = size === "lg" ? "text-2xl" : "text-sm";
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn(dim, "shrink-0 rounded-full object-cover")}
      />
    );
  }
  return <InitialsMark name={name} dim={dim} text={text} />;
}
