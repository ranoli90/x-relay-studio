/** Normalize analysis text without replacing the original transcript. */

const CURLY: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u2032": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2033": '"',
};

export function normalizeAnalysisText(raw: string): string {
  let s = "";
  for (const ch of raw) s += CURLY[ch] ?? ch;
  return s.replace(/\s+/g, " ").trim();
}

export function isGreetingOnly(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /^(hey|hi|hello|yo|sup|wyd|what'?s up|whats up|how are (you|u)|hru|you up|hmu|good (morning|night|evening)|what is up)(\s+\w+){0,6}[\s!.?]*$/.test(
    s,
  );
}

export function isThanksOnly(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /^(thanks|thank you|thx|ty|appreciate it)[\s!.?]*$/.test(s);
}

export function isBareYes(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /^(y|yes|yeah|yep|yea|sure|ok|okay|k)\b[\s!.?]*$/.test(s);
}

export function isDecline(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /\b(not tonight|not now|no thanks|no thank you|i'm good|im good|maybe later|don't want|do not want|not interested|nah)\b/.test(
    s,
  );
}

export function isStopContact(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /\b(stop messaging me|stop contacting me|do not (contact|message|text) me|don't (contact|message|text) me|leave me alone|please stop|unsubscribe|opt out)\b/.test(
    s,
  );
}

export function isIdentityQuestion(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /\b(are you (a |even )?(real|human|a person|an? ai|a bot|a robot)|are you real|is this (a bot|ai|real)|who am i talking to)\b/.test(
    s,
  );
}

export function isQuestion(raw: string): boolean {
  const s = normalizeAnalysisText(raw);
  if (/\?/.test(s)) return true;
  return /^(how|what|why|who|where|when|did|does|do|is|are|can|could|would|will)\b/i.test(s);
}

export function isNegated(raw: string): boolean {
  const s = normalizeAnalysisText(raw).toLowerCase();
  return /\b(not|don't|dont|never|no longer|isn't|isnt|ain't|aint)\b/.test(s);
}

export function isQuoted(raw: string): boolean {
  return /["“”].+["“”]/.test(raw) || /\bsaid\b/i.test(raw);
}
