# Result versioning

Every Benchmark owns an independent immutable sequence of result editions, separate from the Webstone Python package version, HF Dataset revision and website deployment hash.

| Kind | Version | Use when |
| --- | --- | --- |
| `protocol` | MAJOR, e.g. v2.0.0 | Task selection/population, reference answers, scoring or pass criteria change and affect comparability. Add a definition ID when evaluation semantics change. |
| `results` | MINOR, e.g. v1.1.0 | New methods, configurations, measurements or numeric corrections under the same task population and protocol. |
| `metadata` | PATCH, e.g. v1.0.1 | Wording, provenance or links change; measurements, denominators, method identities and configurations stay identical. |

The first release is v1.0.0. A major change resets minor and patch; a minor change resets patch. Never edit a published report, reuse a version or order versions by timestamps. Every change is a new result PR and needs fresh checks and approval.

New files are `results/<benchmark>/<benchmark>-vX.Y.Z-report.json`, with matching `id` and `version`. They contain:

```json
"release": {
  "date": "2026-11-16",
  "kind": "results",
  "previous": "v1.0.0",
  "summary": "Add measured results for a new method."
}
```

`date` is the actual declared UTC publication date reviewed with the PR, not the execution date, source import time or deployment time. Do not use a future date. The CLI proposes today's date when left blank. Reviewers must verify the date and release classification, public evidence and protocol compatibility. CI enforces numeric progression, previous-edition identity, unchanged populations for minor/patch updates and unchanged measurements for patches; reviewers verify semantic changes that cannot be inferred from JSON alone.

Historical vN reports remain byte-for-byte unchanged. They resolve as vN.0.0 without rewriting filenames, identities, download targets or old links. The UI labels `source.importedAt` as **Imported**, because their original publication dates were not recorded. This migration adds no new measurements and fabricates no historical dates.

Use `webstone results template --benchmark <id> --kind results --output result.json`, fill the actual measurements, public evidence and `release.summary`, then validate and submit through the shared CLI. Choose `metadata` or `protocol` when the rules above require it. The CLI allocates the next version against the current target branch and records `release.previous`; after a collision, rebase the PR and obtain review again. The website and CLI must adopt this contract together.
