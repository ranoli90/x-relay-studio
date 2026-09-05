#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--check", "src/workers/reddit-onboarding.ts"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
