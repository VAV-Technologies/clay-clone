# DataFlow test suite

Persistent regression suite that guards the production rollout. Built during the
production-readiness QA initiative (see `.claude-work/plans/`).

## Layout

| Dir | Runner | What | Network/cost |
|---|---|---|---|
| `tests/unit` | Vitest | Pure functions (formula evaluator, filter-utils, detectors, type inference). | none |
| `tests/integration` | Vitest | API route logic. In-process against local sqlite by default; black-box HTTP against a target when `DATAFLOW_TEST_BASE_URL` is set. | none / sandbox |
| `tests/e2e` | Playwright (`*.spec.ts`) | Browser flows against a running app. | sandbox |
| `tests/fixtures` | — | Golden CSVs and seed data. | — |
| `tests/mocks` | — | Stubs for paid providers (AI / email / search) so CI is free. | — |

## Commands

```bash
npm run test               # unit + integration (vitest)
npm run test:unit          # unit only
npm run test:integration   # integration only (in-process, local sqlite)
npm run test:integration:sandbox  # integration against the prod QA sandbox
npm run test:e2e           # Playwright browser suite
npm run typecheck          # tsc --noEmit (baseline budget tracked separately)
```

## Conventions

- **`*.test.ts` = Vitest, `*.spec.ts` = Playwright.** The two never overlap.
- Integration/E2E tests self-create a uniquely-named (`QA-<runId>-…`) sandbox
  project and tear it down via the real cascade-delete path.
- The persistent suite **stubs** paid providers; the one-time QA fleet used real
  calls. Real-call integration tests are gated behind `RUN_PAID=1` and capped.
- A failing test that documents a not-yet-fixed bug is intentional (red →
  green when the fix lands). Such tests reference the bug in a comment.
