import type { Archetype, Intent, Source, UnderstandResult } from "./types.ts";

const PRICE = /\b(how much|price|what('?s| is) (a |the )?(\$|cost)|menu|rates?)\b/i;
const CONTENT = /\b(pic|pics|photo|photos|custom|vid|video|clip|vn|voice note|send (one|some))\b/i;
const GFE = /\b(gfe|girlfriend experience|be my (gf|girlfriend)|exclusive)\b/i;
const REAL = /\b(are you (even )?real|catfish|prove it|send a live|same outfit)\b/i;
const PAY = /\b(i (just )?paid|sent it|cashapp|throne|stars|youpay|here's the (receipt|screenshot))\b/i;
const RECEIPT = /\b(receipt|screenshot of (the )?pay)\b/i;
const BURNED = /\b(got burned|last girl|she took (the )?money|scammed (before|last))\b/i;
const ANGER = /\b(wtf| rip ?off|this is bs|you('re| are) a scam)\b/i;
const CUSTOM = /\b(custom (vid|clip|photo)|specific request)\b/i;
const GREET = /^(hey|hi|hello|yo|sup|wyd|what('?s| is) up)[\s!.]*$/i;

export function understandLocal(
  text: string,
  ctx: { lifetimeCents: number; source: Source; archetype: Archetype; turns: number },
): UnderstandResult {
  const body = text.trim();
  let intent: Intent = "other";
  let objection: UnderstandResult["objection"] = "none";
  let wantsSku: string | null = null;
  let gfeNamed = GFE.test(body);
  let mediaKind: UnderstandResult["mediaKind"] = "none";

  if (GREET.test(body)) intent = "greeting";
  else if (REAL.test(body)) intent = "are_you_real";
  else if (GFE.test(body)) intent = "gfe_ask";
  else if (BURNED.test(body)) {
    intent = "objection_burned";
    objection = "burned";
  } else if (ANGER.test(body)) intent = "anger";
  else if (PAY.test(body) || RECEIPT.test(body)) {
    intent = RECEIPT.test(body) ? "receipt" : "payment_claim";
    mediaKind = RECEIPT.test(body) ? "receipt" : "none";
  } else if (PRICE.test(body)) {
    intent = "price_ask";
    objection = /too much|expensive|cheaper/i.test(body) ? "price" : "none";
  } else if (CUSTOM.test(body)) intent = "custom";
  else if (CONTENT.test(body)) {
    intent = "content_ask";
    if (/\bvn|voice\b/i.test(body)) wantsSku = "voice_note";
    else if (/\bclip|vid|video\b/i.test(body)) wantsSku = "custom_clip";
    else wantsSku = "polaroid_set";
  } else if (ctx.lifetimeCents === 0 && ctx.turns >= 8) intent = "time_waste";

  if (/\bpics?\b/i.test(body) && !wantsSku) wantsSku = "polaroid_set";

  let archetype = ctx.archetype;
  if (ctx.source === "reddit_sugar" && ctx.lifetimeCents === 0) archetype = "reddit_sugar";
  if (ctx.lifetimeCents >= 20000) archetype = "whale";
  else if (ctx.lifetimeCents > 0 && archetype === "new") archetype = "buyer";
  if (objection === "burned") archetype = "burned_daddy";
  if (intent === "time_waste") archetype = "time_waster";

  return {
    intent,
    objection,
    archetype,
    source: ctx.source,
    wantsSku,
    gfeNamed,
    mediaKind,
  };
}
