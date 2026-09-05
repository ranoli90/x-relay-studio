import type { Archetype, Intent, Source, UnderstandResult } from "./types.ts";

const MENU = /\b(menu|rates?|price list|what do you (offer|sell|have))\b/i;
const PRICE = /\b(how much|what('?s| is) (a |the )?(cost|price)|too expensive|cheaper)\b/i;
const SEXT = /\b(sext|sexting)\b/i;
const CALL = /\b(video call|vid call|facetime|cam call|on cam)\b/i;
const DROP = /\b(dropbox|premade|pre-made|folder of (pics?|videos?))\b/i;
const CONTENT = /\b(pic|pics|photo|photos|custom|vid|video|clip|send (one|some))\b/i;
const GFE = /\b(gfe|girlfriend experience|be my (gf|girlfriend)|exclusive|weekly (thing|arrangement))\b/i;
const REAL = /\b(are you (even )?real|catfish|prove it|send a live|same outfit)\b/i;
const PAY = /\b(i (just )?paid|sent (the )?money|here's the (receipt|screenshot))\b/i;
const RECEIPT = /\b(receipt|screenshot of (the )?pay)\b/i;
const BURNED = /\b(got burned|last girl|she took (the )?money|scammed (before|last))\b/i;
const ANGER = /\b(wtf| rip ?off|this is bs|you('re| are) a scam)\b/i;
const CUSTOM = /\b(custom (vid|clip|photo|video)|specific request)\b/i;
const GREET =
  /^(hey|hi|hello|yo|sup|wyd|what('?s| is) up|how are (you|u)|hru)(\s+[\w']+){0,6}[\s!.?]*$/i;

export function understandLocal(
  text: string,
  ctx: { lifetimeCents: number; source: Source; archetype: Archetype; turns: number },
): UnderstandResult {
  const body = text.trim();
  let intent: Intent = "other";
  let objection: UnderstandResult["objection"] = "none";
  let wantsSku: string | null = null;
  const gfeNamed = GFE.test(body);
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
  } else if (MENU.test(body)) intent = "menu";
  else if (PRICE.test(body)) {
    intent = "price_ask";
    objection = /too much|expensive|cheaper/i.test(body) ? "price" : "none";
  } else if (CUSTOM.test(body) || SEXT.test(body) || CALL.test(body) || DROP.test(body)) {
    intent = CUSTOM.test(body) ? "custom" : "content_ask";
    if (SEXT.test(body)) wantsSku = "sexting_session";
    else if (CALL.test(body)) wantsSku = "video_call";
    else if (DROP.test(body)) wantsSku = "premade_dropbox";
    else wantsSku = "custom_clip";
  } else if (CONTENT.test(body)) {
    intent = "content_ask";
  } else if (ctx.lifetimeCents === 0 && ctx.turns >= 8) intent = "time_waste";

  if (intent === "greeting" && ctx.lifetimeCents === 0 && ctx.turns >= 8) {
    intent = "time_waste";
  }

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
