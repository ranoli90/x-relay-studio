export const OWNER_KICKS = [
  {
    id: "captcha",
    title: "Security check",
    hint: "Reddit blocks automation here. Tap the real control on the page.",
    wait: /security|captcha|robot/i,
  },
  {
    id: "terms",
    title: "User Agreement",
    hint: "Read it, then tick the real box. We will not accept terms for you.",
    wait: /terms|agreement/i,
  },
  {
    id: "final_submit",
    title: "Sign Up",
    hint: "The last click has to be yours. Tap Reddit’s Sign Up button.",
    wait: /create|submit|sign up/i,
  },
] as const;

export type OwnerKickId = (typeof OWNER_KICKS)[number]["id"];

export function initialKickIndex(waitReason: string | null | undefined): number {
  if (!waitReason) return 0;
  const index = OWNER_KICKS.findIndex((step) => step.wait.test(waitReason));
  return index < 0 ? 0 : index;
}

export function fixtureKickUrl(opts: { username?: string | null; step: OwnerKickId }): string {
  const params = new URLSearchParams();
  params.set("kick", opts.step);
  if (opts.username) params.set("username", opts.username);
  return `/__reddit-onboarding-fixture/index.html?${params.toString()}`;
}

export const FIXTURE_KICK_MESSAGE = "reddit-onboarding-fixture";
export const PARENT_KICK_MESSAGE = "reddit-onboarding-parent";
