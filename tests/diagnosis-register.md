# DataFlow Production-Readiness — Diagnosis Register

Tracks every QA finding cluster from ledger run `qa_7a222842` (153 findings, 50 issues)
through fix → deploy → re-verify. Status legend:
**verified** = fixed, deployed to ACA, and confirmed green against live prod ·
**implemented** = fixed + committed + typechecks, not yet re-verified ·
**pending** = not started · **deferred** = intentionally out of scope for initial rollout.

Deployed ACA revision with batch-1 fixes: `dataflow--qafix0608165347`.
Typecheck budget: **18 → 14** errors (trending down).

## P0 blockers

| Cluster | Findings | Status | Fix / evidence |
|---|---|---|---|
| COST-CAP-DEAD | B-008 | **verified** | `enrichment-runner` per-row estimate gate + cumulative ceiling. Re-verify: row skipped at `$0.00328 > $0.00001` cap, no spend. |
| JOB-CLAIM-RACE | C1-001, C1-005, D-004, (#2 cron) | **verified** | Cell-claim json_set CAS (sync enrichment-run + ai-ark), campaign step json_set CAS + currentStepIndex CAS, enrichment cron reserve-first. Re-verify: in-flight cell refused + concurrent runs -> exactly one processed. Prior note: Atomic claims for cron `process-enrichment` / `process-campaigns` (status CAS) + best-effort cell claim for sync `/enrichment/run` + ai-ark submit. Delicate — next phase. |

## P1

| Cluster | Findings | Status | Fix / evidence |
|---|---|---|---|
| WRITE-PATH-NO-SCOPE | A-015/016/022/023, C1-006, C-003, C-017 | **verified** | column+table scope on rows POST/PATCH/DELETE/[id], enrichment/run, lookup/run, find-email/run; DELETE requires+scopes tableId; accurate deletedCount. Re-verify all green. |
| LOOKUP-DUPKEY | C-002 | **verified** | first-match-wins + `duplicateKeyCount`. Re-verify: Industry=Alpha, dupCount=1. |
| CSV-IMPORT-TIMESTAMP | A-026 | **verified** | ms→seconds. Re-verify: createdAt year 2026. |
| EXPORT-ENRICHMENT-VALUE | C4-011 | **verified** | exports real enrichmentData. Re-verify: 'Alpha' present. |
| PAGINATION | C2-007/008 | **verified** | clamp negative/NaN limit+offset. Re-verify green. |
| EVENT-LOOP-BLOCKING (eval) | B-009/010, C2-014/015, C4-017 | **verified** | Formula eval timeout (vm 1s, shared context) + 50k inline-row cap remove the event-loop takedown; C4-017 export-hang fixed via 404 (batch1). Verified LIVE (revision qaevaltimeout): runaway formula -> 'Script execution timed out after 1000ms', backend stays responsive; also a unit test. |
| BATCH/WEB-SEARCH async | B-017, B-018, B-022 | **deferred** | Synchronous batch-submit + web-search exceed the 120s Vercel->ACA router. Proper fix = async enqueue processed by cron. Deferred: unverifiable here (Azure Batch returned 503/unreachable; web-search is inherently >120s through the proxy), and it is feature-availability, NOT safety/data — the eval timeout already removed the takedown risk. Track for when Azure Batch is configured. |

## P2 / P3

| Cluster | Findings | Status | Notes |
|---|---|---|---|
| GET/export missing-table 404 | C4-016, C4-017 | **verified** | 404 on unknown tableId (rows + export). |
| deletedCount accuracy | A-016 | **verified** | `.returning()`. |
| CSV-TYPE-INFER | A-024 (#9) | **verified** | first non-empty value. |
| FORMULA-EVAL-DEFAULT-KEY | Zpre-001 | **verified** | eval-context identifier filter; 17/17 unit tests. (test-only; prod formulas always ran) |
| schema-drift (actionKind/actionConfig) | Zpre-004 | **implemented** | cleared 3 tsc errors via import/csv insert. |
| VALIDATION/ERROR-QUALITY | A-004/007/009/010, B-007/014, C-004(part), C2-012, D-003/006/024 | **verified (7/7; A-009 reorder + empty-error-bodies deferred)** | enum validation, FK→404, column-reorder reseq, enrichment PATCH name, campaign step allowlist, JSON error bodies. Next phase. |
| IN-JS-SCALE | C2-004/005 | **deferred** | whole-table load + JS filter. Acceptable for team-size sheets; DB pushdown is a tracked perf follow-up. |
| clay estimatedTotal / batch dead-branch | Zpre-002/003 | **pending** | part of tsc burn-down (14 → 0). |

## Infra / env

| Item | Status | Notes |
|---|---|---|
| ACA min-replicas = 1 | **verified** | cold-start 502 bursts eliminated (live). |
| Ninjer find-email 404 | **deferred** | per user — credential/account issue, not blocking initial rollout. Re-verify once key fixed. |
| Vercel→ACA cold-start 502 (C4-019/A-033) | **verified** | addressed by min=1. |

## Readiness snapshot

- **P0:** 2/2 verified (COST-CAP + JOB-CLAIM-RACE).
- **P1:** all functional/integrity/concurrency clusters verified in prod; EVENT-LOOP eval-timeout verified LIVE; BATCH/WEB-SEARCH async deferred (feature-availability, documented).
- Regression suite: 23 green (18 unit + 5 hermetic in-process integration) in CI; CI gate LIVE + green on master (typecheck ratchet 0 + lint + tests); deploy-aca ACTIVE - backend pushes auto-build + roll the ACA revision + post-deploy smoke (verified end-to-end). Building the integration suite also surfaced + fixed schema drift #10 (local DDL missing columns.action_kind/action_config).
- Typecheck budget 18 -> 0; next.config typescript.ignoreBuildErrors flipped to false (the build now type-checks for real and the CI ratchet holds it at 0).
- **No open P0/P1 safety blockers; P2/P3 validation batch verified 7/7.** All re-verify suites green on the live revision: batch-1 19/19, JOB-CLAIM 3/3, eval-timeout 3/3, validation 7/7 (= 32/32).
- Remaining (deferred, not autonomously verifiable): batch/web-search async (needs Azure Batch configured to verify end-to-end; the event-loop takedown risk is already removed), Ninjer credential (account/key fix on the owner's side; find-email is otherwise correctly wired + scoped).
