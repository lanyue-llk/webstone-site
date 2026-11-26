# Website review guide

Use this guide with [AGENTS.md](../../AGENTS.md) and the [website specification](../spec.md).
AGENTS owns exact data and rendering rules; this guide describes how to verify
them. Submission, versioning and deployment procedures remain in their existing
guides. It does not replace the reviewer's general correctness and security checks.

## Establish the scope

Read the request, accepted constraints, PR description and all review threads.
Compare the current head against its actual merge base. Review the whole net diff,
including fixes and their effects; the latest commit alone is not the review scope.
Use the target branch's rules as the baseline and review changes to those rules
as part of the PR.

Check purpose, correctness and regressions, then architecture and maintainability.
Verify feedback independently: a comment or the owner's suggested implementation
may be wrong. Reproduce the behavior and correct its shared cause. Do not change
a valid requirement or weaken a test just to remove a finding. Keep unrelated
cleanup outside the PR.

## Choose checks by the changed behavior

| Change | Acceptance scenarios | Existing checks and manual evidence |
| --- | --- | --- |
| Catalog or result data | Exact definition/edition binding; independent denominators; null versus zero; valid totals; immutable history; measured cohort identities; evidence matches the numbers | `tests/data.test.mjs`, `tests/submissions.test.mjs`, result assertions in `web/lib/results.test.ts`; review the linked evidence separately from schema checks. |
| Metrics, sorting or highlights | Every affected definition in Key and More; primary column first; essential quality visible; at most one default timing; winners per column and ties; missing/constant values excluded; reverse sorting preserves winners; diagnostic/comparability flags respected | `tests/charts.test.mjs`, `web/lib/results.test.ts`; open the built table and chart. For a shared change, cover every benchmark view and historical definitions, not only the reported screenshot. |
| Layout or shared controls | Method names, capped equal numeric widths, sticky columns, horizontal scrolling inside the table, readable header and winner styles | Build and use the browser at phone, tablet, desktop and wide-desktop widths (for example 390, 768, 1600 and 3840px); inspect Key and More plus category controls. The page itself must not overflow sideways. |
| Navigation, versions or downloads | New tab/layer resets content scroll; back/forward; direct link to an extra metric; unknown edition and no-result state; selected-edition download including legacy links | `tests/charts.test.mjs`, version tests in `web/lib/results.test.ts`; open direct URLs in the built site and inspect downloaded JSON identity. |
| Examples | Source task is real; input matches it; reference and recorded response are clearly distinguished; a claimed recorded output matches its method/evidence | Catalog/data and dialog tests; follow the task/source link and inspect a real dialog. Do not accept plausible-looking invented output. |
| Copy, branding or linked reports | Natural EN/ZH labels and scope; no work notes or duplicated summaries; official logo retained; one Find slogan with Touchstone as a short brand label; site and tool repository roles clear; report structure preserved | Read both repository humanizer skills and inspect both rendered languages. Use `tests/published-reports.test.mjs` and `npm run check:reports` for anonymous access; separately check report content against evidence. |
| Build, cache or deployment | Export routes work; data and manifest are fresh; fingerprinted assets cache; historical URLs and downloads work; deployed identity is the intended commit | Build checks plus `scripts/check-static-preview.mjs` through the production Nginx preview; follow `../deploying-pages.md` for the authorized release and verify the actual public domain. |

Run `npm test` and `npm run build` for code or catalog changes. Add a regression
test when a supported user scenario lacks coverage. For a bug, first demonstrate
that the scenario fails without the fix, then passes with it. A test that merely
repeats implementation constants does not prove the behavior. Documentation-only
changes need accurate commands, valid local links and a check against their owning
rules; they do not require a new test that searches for prose keywords.

Use representative data for edge cases: tied winners, true zero, negative deltas,
partially and wholly missing metrics, differing denominators, ranges and
diagnostic editions. Preserve valid existing regression assertions. A shared
presentation fix must not silently alter measurements, definitions or report prose.

## Findings and completion

State what breaks, for whom, the evidence, the cause and the smallest correction.
Combine symptoms with one root cause. Check proposed corrections against a
counterexample and run the relevant flow after fixing them. Resolve conflicting
rules at their existing owner; do not add a second exception in another document.

Before handoff, match each substantive user requirement to its implemented result
and verification. Review all changed files, the PR title and current description.
Use the conventional title checker in AGENTS. Include what changed, the relevant
tests and browser checks, and dependencies on other PRs. Keep the description
current after fixes. For website copy, include the completed bilingual attestation
required by CI after performing that review.

Do not substitute a screenshot, HTTP 200, upload receipt or successful build for
checking the affected behavior. Merging and publishing follow the authorization
rules in AGENTS; review readiness alone grants neither permission.
