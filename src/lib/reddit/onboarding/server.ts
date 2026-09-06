import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  accountIdQuerySchema,
  autoIsolatedOnboardingSchema,
  bindEmailSchema,
  cancelSchema,
  completeFixtureSchema,
  confirmIdentitySchema,
  confirmSubmitSchema,
  continueManualSchema,
  createOnboardingSchema,
  deleteBindingSchema,
  eventsQuerySchema,
  queueCreateAccountsSchema,
  generateDraftSchema,
  jobIdQuerySchema,
  liveInputSchema,
  liveSessionQuerySchema,
  saveDetailsSchema,
  saveSteelHostSchema,
  startOauthSchema,
  startOnboardingSchema,
  versionedJobSchema,
} from "./schemas.ts";

async function impl() {
  return import("./impl.server");
}

export const getOnboardingBootstrap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGetOnboardingBootstrap(opts as never);
  });

export const createOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => createOnboardingSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleCreateOnboarding(opts as never);
  });

export const queueRedditCreates = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => queueCreateAccountsSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleQueueRedditCreates(opts as never);
  });

export const saveOnboardingDetails = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => saveDetailsSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleSaveOnboardingDetails(opts as never);
  });

export const startOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => startOnboardingSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleStartOnboarding(opts as never);
  });

export const getOnboardingJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => jobIdQuerySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGetOnboardingJob(opts as never);
  });

export const getOnboardingEvents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => eventsQuerySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGetOnboardingEvents(opts as never);
  });

export const continueManualOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => continueManualSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleContinueManualOnboarding(opts as never);
  });

export const requestOnboardingTakeover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleRequestOnboardingTakeover(opts as never);
  });

export const finishOnboardingTakeover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleFinishOnboardingTakeover(opts as never);
  });

export const getOnboardingControlView = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGetOnboardingControlView(opts as never);
  });

export const confirmSignupSubmission = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => confirmSubmitSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleConfirmSignupSubmission(opts as never);
  });

export const startJobBoundRedditOAuth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => startOauthSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleStartJobBoundRedditOAuth(opts as never);
  });

export const confirmConnectedIdentity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => confirmIdentitySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleConfirmConnectedIdentity(opts as never);
  });

export const cancelOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => cancelSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleCancelOnboarding(opts as never);
  });

export const handoffOnboardingToManual = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleHandoffOnboardingToManual(opts as never);
  });

export const completeFixtureOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => completeFixtureSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleCompleteFixtureOnboarding(opts as never);
  });

export const startIsolatedOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => autoIsolatedOnboardingSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleStartIsolatedOnboarding(opts as never);
  });

export const autoRunIsolatedOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => autoIsolatedOnboardingSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleAutoRunIsolatedOnboarding(opts as never);
  });

export const loadRedditAccountActions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdQuerySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleLoadRedditAccountActions(opts as never);
  });

export const bindRedditRecoveryEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => bindEmailSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleBindRedditRecoveryEmail(opts as never);
  });

export const deleteRedditRecoveryEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => deleteBindingSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleDeleteRedditRecoveryEmail(opts as never);
  });

export const generateRedditDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => generateDraftSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGenerateRedditDraft(opts as never);
  });

export const closeRedditBrowser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdQuerySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleCloseRedditBrowser(opts as never);
  });

export const deleteRedditRetainedSignIn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdQuerySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleDeleteRedditRetainedSignIn(opts as never);
  });

export const captureOnboardingLiveFrame = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => liveSessionQuerySchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleCaptureOnboardingLiveFrame(opts as never);
  });

export const sendOnboardingLiveInput = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => liveInputSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleSendOnboardingLiveInput(opts as never);
  });

export const saveOnboardingSteelHost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => saveSteelHostSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleSaveOnboardingSteelHost(opts as never);
  });

export const disconnectOnboardingSteelHost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async (opts) => {
    const m = await impl();
    return m.handleDisconnectOnboardingSteelHost(opts as never);
  });

