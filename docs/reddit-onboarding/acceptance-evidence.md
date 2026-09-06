# Acceptance matrix — implementation evidence

Design cases: `Acceptance_Test_Matrix.md` (106). Ordinary CI must not create Reddit accounts or spend provider credits.

Status vocabulary: implemented_unverified; passed_fixture; blocked_external; not_applicable_with_reason.

| IDs | Status | Evidence |
|---|---|---|
| RN-001–RN-012 chooser / manual / existing | implemented_unverified | `src/components/reddit/onboarding/*`, `app.tsx` F01 user-scoped cache, dashboard Add |
| RN-009 assisted → manual | passed_fixture | `store.test.ts` `handoffToManual` while assisted job is active; queues session/context cleanup; preserves the same job id |
| RN-013 invalid transition | passed_fixture | `machine.test.ts` |
| RN-014/015 idempotency | passed_fixture | `store.test.ts` and `tx.test.ts` same key reuse + conflict; enqueue retry after version change returns original command |
| RN-016 one active job | passed_fixture | unique index + `createOrReuseDraft` |
| RN-017 two workers / one job | passed_fixture | `lease.test.ts` exclusive per-job lease (PGlite sequential claims) |
| RN-018 old worker after generation change | passed_fixture | `lease.test.ts` `transitionJob` with stale `leaseGeneration` → `STALE_LEASE` |
| RN-019 lease lost before action | passed_fixture | `lease.test.ts` expired `renewLease` throws; caller must stop |
| RN-020/021/022 no submit replay | passed_fixture | machine `SUBMIT_LOST` / `irreversibleSubmitBlocked`; worker never replays submit |
| RN-025 failed state+event write | passed_fixture | `tx.test.ts` injected failure after job/command/event insert; PGlite rollback leaves no rows |
| RN-028 privacy fail-closed | passed_fixture | fake provider `failPrivacy`; `providers/fake.test.ts` knobs |
| RN-031 release accepted but still running | passed_fixture | `cleanup.test.ts` `SESSION_STILL_RUNNING` keeps task queued |
| RN-036 control view while worker owns | passed_fixture | `getOnboardingControlView` refuses unless `control_owner=user` |
| RN-041–054 OAuth identity/cap | implemented_unverified | `complete-oauth.ts` expected identity, advisory lock, cap 8; callback idempotent `processing_state` |
| RN-043 callback replay | implemented_unverified | stored `processed_result_json` |
| RN-051 popup closed | implemented_unverified | `add-account.tsx` closed watcher |
| RN-055–070 health/copy/scopes | passed_fixture / implemented_unverified | `health.test.ts`, F03 privatemessages copy, F07 unknown public profile |
| RN-071–085 worker/fake provider | passed_fixture | `store.test.ts` drain cancel; allocation intent reuse; `providers/fake.test.ts` full ids |
| RN-086–095 Stagehand bounds | passed_fixture | `policy.test.ts` navigation/action/frame denials; `controller.test.ts` owner checkpoints; `email-signup.ts` |
| RN-096–106 cleanup/retention/ops | passed_fixture / implemented_unverified | `cleanup.test.ts` (queue, claim, revoke, purge, expire profiles); `retention.test.ts`; disconnect disable+queue; rollback doc |

Live Browserbase, live Reddit signup, Director runtime, and production migrate: **blocked_external**. Never reported as live success.

Full original matrix remains the requirement list; this file records what this branch actually ran.
