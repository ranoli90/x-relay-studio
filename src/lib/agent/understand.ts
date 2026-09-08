import type { Archetype, CatalogRow, Source, UnderstandResult } from "./types.ts";
import { interpretMessage } from "../operator/interpret.ts";

export function understandLocal(
  text: string,
  ctx: {
    lifetimeCents: number;
    source: Source;
    archetype: Archetype;
    turns: number;
    pendingQuestion?: string | null;
    catalog?: CatalogRow[] | null;
  },
): UnderstandResult {
  return interpretMessage(text, ctx).result;
}
