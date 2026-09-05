const BANNED = /\breddit\b|\bsnoo\b/i;

export function deskParts(deskNumber: string) {
  const d = deskNumber.replace(/\D/g, "");
  const head = d.slice(0, 4) || "1000";
  const tail = d.slice(-4) || "0001";
  return { head, tail, digits: d };
}

export function appNameForDesk(deskNumber: string) {
  const { head, tail } = deskParts(deskNumber);
  return `Desk ${head} ${tail} mail`;
}

export function appIdForDesk(deskNumber: string) {
  const { head, tail } = deskParts(deskNumber);
  return `desk.${head}.${tail}`;
}

export function appDescriptionForDesk(deskNumber: string) {
  const { head, tail } = deskParts(deskNumber);
  return `Personal mail desk ${head}-${tail} for Reddit. Own inbox and health only. Not an official client.`;
}

export function apiSignupBlurb(deskNumber: string) {
  const name = appNameForDesk(deskNumber);
  return `Non-commercial personal app named ${name}. I am not a moderator and will not use this as a mod tool. If I later post, it is only as a normal user in regular public subreddits. The account that will run the app is a separate warmed-up account, not the account submitting this Data API request. Until then this app only reads my own inbox and account health. No scraping, resale, or AI training. One app. One use.`;
}

export function assertSafeAppName(name: string) {
  if (BANNED.test(name)) {
    throw new Error("The app name cannot include Reddit or Snoo. Reddit’s Data API Terms forbid that.");
  }
  return name;
}

export function userAgentFor(redditUsername: string, appId: string) {
  const handle = redditUsername.replace(/^u\//, "").trim() || "unknown";
  const id = appId.replace(/[^a-z0-9._-]/gi, "") || "desk.mail";
  assertSafeAppName(id);
  return `web:${id}:v1.0.0 (by /u/${handle})`;
}
