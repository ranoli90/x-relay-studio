# Acceptance matrix — implementation evidence

Design cases: `Acceptance_Test_Matrix.md` (106). Ordinary CI must not create Reddit accounts or spend provider credits.

Status vocabulary: implemented_unverified; passed_fixture; blocked_external; not_applicable_with_reason.

| IDs | Status | Evidence |
|---|---|---|
| RN-001–RN-012 chooser / manual / existing | implemented_unverified | `src/components/reddit/onboarding/*`, `app.tsx` F01 user-scoped cache, dashboard Add |
| RN-013 invalid transition | passed_fixture | `machine.test.ts` |
| RN-014/015 idempotency | passed_fixture | `store.test.ts` same key reuse + conflict |
| RN-016 one active job | passed_fixture | unique index + `createOrReuseDraft` |
| RN-020/021/022 no submit replay | passed_fixture | machine `SUBMIT_LOST` / `irreversibleSubmitBlocked`; worker never replays submit |
| RN-028 privacy fail-closed | passed_fixture | fake provider `failPrivacy` |
| RN-036 control view while worker owns | passed_fixture | `getOnboardingControlView` refuses unless `control_owner=user` |
| RN-041–054 OAuth identity/cap | implemented_unverified | `complete-oauth.ts` expected identity, advisory lock, cap 8; callback idempotent `processing_state` |
| RN-043 callback replay | implemented_unverified | stored `processed_result_json` |
| RN-051 popup closed | implemented_unverified | `add-account.tsx` closed watcher |
| RN-055–070 health/copy/scopes | passed_fixture / implemented_unverified | `health.test.ts`, F03 privatemessages copy, F07 unknown public profile |
| RN-071–085 worker/fake provider | passed_fixture | `store.test.ts` drain cancel; allocation intent reuse |
| RN-086–095 Stagehand bounds | passed_fixture | `policy.test.ts` navigation/action denials; `email-signup.ts` |
| RN-096–106 cleanup/retention/ops | implemented_unverified | `cleanup.ts`, disconnect disable+queue, rollback doc |

Live Browserbase, live Reddit signup, Director runtime, and production migrate: **blocked_external**. Never reported as live success.

Full original matrix remains the requirement list; this file records what this branch actually ran.
