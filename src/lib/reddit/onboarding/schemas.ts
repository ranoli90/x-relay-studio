import { z } from "zod";
import {
  COMMAND_KINDS,
  JOB_INTENTS,
  JOB_MODES,
} from "./types.ts";

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export const correlationIdSchema = z.string().trim().min(8).max(80);
export const idempotencyKeySchema = z.string().trim().min(8).max(128);
export const jobIdSchema = z.string().uuid();
export const versionSchema = z.number().int().min(1).max(1_000_000);

export const usernameSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^u\//i, ""))
  .pipe(z.string().regex(USERNAME_RE, "Use 3–20 letters, numbers, or underscores."));

export const createOnboardingSchema = z
  .object({
    mode: z.enum(JOB_MODES),
    intent: z.enum(JOB_INTENTS),
    expectedUsername: usernameSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const queueCreateAccountsSchema = z
  .object({
    count: z.number().int().min(1).max(5),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const autoIsolatedOnboardingSchema = z
  .object({
    mode: z.enum(JOB_MODES),
    intent: z.enum(JOB_INTENTS),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const saveDetailsSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    expectedUsername: usernameSchema.optional(),
    retainContext: z.boolean().optional(),
    retainPassword: z.boolean().optional(),
    assistanceConsent: z.boolean().optional(),
    correlationId: correlationIdSchema,
  })
  .strict()
  .refine((d) => !d.retainPassword || d.assistanceConsent === true, {
    message: "Password retention requires guided-setup consent.",
    path: ["retainPassword"],
  });

export const startOnboardingSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    consentVersion: z.string().trim().min(1).max(80),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const jobIdQuerySchema = z
  .object({
    jobId: jobIdSchema,
  })
  .strict();

export const eventsQuerySchema = z
  .object({
    jobId: jobIdSchema,
    afterSequence: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const versionedJobSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const confirmSubmitSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    confirmation: z.string().trim().min(16).max(128),
    correlationId: correlationIdSchema,
  })
  .strict();

export const continueManualSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    username: usernameSchema,
    ownerCreated: z.boolean(),
    correlationId: correlationIdSchema,
  })
  .strict();

export const startOauthSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    origin: z.string().url().max(300),
    transport: z.enum(["local", "remote"]).default("local"),
    correlationId: correlationIdSchema,
  })
  .strict();

export const confirmIdentitySchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    confirmation: z.string().trim().min(8).max(200),
    correlationId: correlationIdSchema,
  })
  .strict();

export const cancelSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const savedAccessQuerySchema = z
  .object({
    accountId: z.string().uuid(),
  })
  .strict();

export const deleteSavedAccessSchema = z
  .object({
    accountId: z.string().uuid(),
    kind: z.enum(["browser_context", "retained_password"]),
    recentAuth: z.literal(true),
    correlationId: correlationIdSchema,
  })
  .strict();

export const disconnectSchema = z
  .object({
    accountId: z.string().uuid(),
    recentAuth: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
  })
  .strict();

export const commandPayloadSchema = z
  .object({
    kind: z.enum(COMMAND_KINDS),
    expectedUsername: z.string().max(20).optional(),
    formFingerprint: z.string().max(128).optional(),
    confirmationHash: z.string().max(128).optional(),
    expiresAt: z.string().max(40).optional(),
  })
  .strict()
  .refine((p) => !("password" in p) && !("code" in p) && !("otp" in p), {
    message: "Sensitive fields cannot be queued.",
  });

export const sensitiveCommandGuard = z
  .object({})
  .passthrough()
  .superRefine((val, ctx) => {
    const banned = ["password", "otp", "code", "token", "cookie", "secret"];
    for (const key of Object.keys(val)) {
      if (banned.includes(key.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          message: "Sensitive payload rejected.",
          path: [key],
        });
      }
    }
  });

export const eventDetailsSchema = z
  .object({
    code: z.string().max(80).optional(),
    step: z.string().max(40).optional(),
    durationMs: z.number().int().optional(),
    provider: z.string().max(40).optional(),
    reason: z.string().max(120).optional(),
  })
  .strict();

export const accountIdQuerySchema = z
  .object({
    accountId: z.string().min(8).max(80),
  })
  .strict();

export const completeFixtureSchema = z
  .object({
    jobId: jobIdSchema,
    version: versionSchema,
    username: usernameSchema.optional(),
    correlationId: correlationIdSchema,
  })
  .strict();

export const bindEmailSchema = z
  .object({
    accountId: z.string().min(8).max(80),
    address: z.string().trim().email().max(200),
    correlationId: correlationIdSchema,
  })
  .strict();

export const deleteBindingSchema = z
  .object({
    accountId: z.string().min(8).max(80),
    bindingId: z.string().min(8).max(80),
    correlationId: correlationIdSchema,
  })
  .strict();

export const generateDraftSchema = z
  .object({
    accountId: z.string().min(8).max(80),
    communityAllowlist: z.array(z.string().trim().min(2).max(40)).min(1).max(20),
    topic: z.string().trim().min(3).max(200),
    assertedFacts: z.string().trim().max(2000).optional(),
    selectedCommunity: z.string().trim().max(40).optional(),
    correlationId: correlationIdSchema,
  })
  .strict();

export const saveRedditAppSchema = z
  .object({
    clientId: z.string().trim().min(8).max(80),
    clientSecret: z.string().trim().min(8).max(200),
    userAgentName: z.string().trim().min(1).max(40),
    origin: z.string().url().max(300),
    acceptedTerms: z.boolean(),
  })
  .strict();

export const originSchema = z
  .object({
    origin: z.string().url().max(300),
  })
  .strict();

export const accountIdSchema = z
  .object({
    accountId: z.string().uuid(),
  })
  .strict();

export const confirmOnboardingSchema = z
  .object({
    accountId: z.string().uuid(),
    phrase: z.string().trim().min(8).max(200),
  })
  .strict();

export function fingerprintRequest(body: unknown): string {
  return JSON.stringify(body, Object.keys(body as object).sort());
}

export function normalizeUsername(raw: string): string {
  return raw.replace(/^u\//i, "").trim();
}

export const liveSessionQuerySchema = z
  .object({
    sessionId: z.string().trim().min(8).max(120),
    jobId: jobIdSchema,
  })
  .strict();

export const liveInputSchema = z
  .object({
    sessionId: z.string().trim().min(8).max(120),
    jobId: jobIdSchema,
    action: z.enum(["click", "type", "key"]),
    x: z.number().min(0).max(4000).optional(),
    y: z.number().min(0).max(4000).optional(),
    text: z.string().max(200).optional(),
    key: z.string().max(40).optional(),
  })
  .strict();

export const saveSteelHostSchema = z
  .object({
    apiKey: z.string().trim().min(16).max(200),
  })
  .strict();

