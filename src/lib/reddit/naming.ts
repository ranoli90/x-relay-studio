import { createHash } from "node:crypto";

const BANNED = /\breddit\b|\bsnoo\b/i;
const APP_VERSION = "v0.2.0";

/** Opaque token derived from the restore number. Digits never appear in public names. */
export function opaqueDeskToken(deskNumber: string): string {
  const d = deskNumber.replace(/\D/g, "");
  if (d.length < 8) {
    throw new Error("A desk number is required before naming a Reddit app.");
  }
  return createHash("sha256").update(`xrelay-reddit-app:${d}`).digest("hex").slice(0, 10);
}

export function appNameForDesk(deskNumber: string) {
  return `Desk mail ${opaqueDeskToken(deskNumber)}`;
}

export function appIdForDesk(deskNumber: string) {
  return `desk.mail.${opaqueDeskToken(deskNumber)}`;
}

export function appDescriptionForDesk(deskNumber: string) {
  return `Personal mail desk ${opaqueDeskToken(deskNumber)} for inbox and health only. Not an official client.`;
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
  const handle = redditUsername.replace(/^u\//, "").trim();
  if (!handle) {
    throw new Error("A Reddit username is required before calling the Data API.");
  }
  const id = appId.replace(/[^a-z0-9._-]/gi, "");
  if (!id) {
    throw new Error("A Reddit app id is required before calling the Data API.");
  }
  assertSafeAppName(id);
  return `web:${id}:${APP_VERSION} (by /u/${handle})`;
}
