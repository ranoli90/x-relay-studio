import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  accountIdSchema,
  confirmOnboardingSchema,
  originSchema,
  saveRedditAppSchema,
} from "./onboarding/schemas";

async function impl() {
  return import("./impl.server");
}

export const getBootstrap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGetBootstrap(opts as never);
  });

export const saveRedditApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => saveRedditAppSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleSaveRedditApp(opts as never);
  });

export const getSetupCopy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => originSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleGetSetupCopy(opts as never);
  });

export const startRedditOAuth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => originSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleStartRedditOAuth(opts as never);
  });

export const runHealthCheck = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleRunHealthCheck(opts as never);
  });

export const confirmOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => confirmOnboardingSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleConfirmOnboarding(opts as never);
  });

export const loadInbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleLoadInbox(opts as never);
  });

export const disconnectAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdSchema.parse(d))
  .handler(async (opts) => {
    const m = await impl();
    return m.handleDisconnectAccount(opts as never);
  });

