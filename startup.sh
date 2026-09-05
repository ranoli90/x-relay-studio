#!/bin/sh
set -eu
cd /workspace
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true
if [ -z "${XRELAY_ALLOW_SIMULATOR:-}" ]; then
  export XRELAY_ALLOW_SIMULATOR=isolated-fixture
fi
export REDDIT_ONBOARDING_ENABLED="${REDDIT_ONBOARDING_ENABLED:-true}"
export REDDIT_ASSISTED_SIGNUP_ENABLED="${REDDIT_ASSISTED_SIGNUP_ENABLED:-false}"
export REDDIT_BROWSER_PROVIDER="${REDDIT_BROWSER_PROVIDER:-fake}"

alive() {
  pidfile="$1"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
  echo $! >/tmp/app-dev.pid
fi
if ! alive /tmp/agent-worker.pid; then
  node scripts/agent-worker.mjs >>/tmp/agent-worker.log 2>&1 &
  echo $! >/tmp/agent-worker.pid
fi
if ! alive /tmp/reddit-onboarding-worker.pid; then
  node --experimental-strip-types src/workers/reddit-onboarding.ts >>/tmp/reddit-onboarding-worker.log 2>&1 &
  echo $! >/tmp/reddit-onboarding-worker.pid
fi
exit 0
