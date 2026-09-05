#!/bin/sh
set -eu
cd /workspace
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true
if [ -z "${XRELAY_ALLOW_SIMULATOR:-}" ]; then
  export XRELAY_ALLOW_SIMULATOR=isolated-fixture
fi
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
fi
if ! pgrep -f 'scripts/agent-worker.mjs' >/dev/null 2>&1; then
  node scripts/agent-worker.mjs >>/tmp/agent-worker.log 2>&1 &
fi
exit 0
