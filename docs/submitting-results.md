# Submit public benchmark results

Webstone and external contributors use the same `webstone results` CLI and Python SDK. Results are reviewed pull requests in `lexmount/webstone-site`; there is no website account, upload database or privileged internal publication endpoint. The website remains a static publication of approved versions.

## Install and authenticate

The results command is new. Until a PyPI release containing it is published, install from the maintained source using Python 3.11 or later:

```sh
pip install "git+https://github.com/lexmount/webstone.git"
gh auth login
webstone results --help
```

Install [GitHub CLI](https://cli.github.com/) if needed. Use your own contributor login. Rainbond's repository-read credential is a deployment credential and is not used for submissions.

## Prepare and submit

```sh
webstone results template --benchmark lexbench-webfetch --definition split-media --output report.json
# Fill the template with measured values and public evidence.
webstone results validate report.json
webstone results submit report.json --provider-url your-method=https://example.com/project --dry-run
webstone results submit report.json --provider-url your-method=https://example.com/project
```

Templates contain empty placeholders, not fabricated measurements. `validate` performs local preflight; the trusted repository validator and human evidence review are authoritative. Each file contains one benchmark, references an existing `definitionId`, and supplies the actual `taskCount`, metric values, method configurations and any category/sample counts. Use `null` for unavailable metrics; preserve genuine zeros and the original units. `datasetDifference` explains the difference from the linked dataset in English. Preserve original evidence and quotations separately from display translations.

Every new submission needs a public HTTPS `source.url`. Disclose dataset/scorer identities, sample selection, execution and timing conditions, billing bases and limitations in the supplied provenance and report. A version-specific `reportUrl` is only supplied when it describes that result. The shared Track report remains visible independently.

For a new participant, `--provider-url ID=HTTPS_URL` proposes its official product or GitHub link. Only additive project links used by the submitted methods are allowed; changing benchmark definitions, existing participant links or website code needs a separate PR.

The CLI reads the current main commit, allocates the next numeric version for that benchmark, creates a result-only commit in your personal fork, and opens a PR against main. Internal contributors follow the same path. Input measurements are not rewritten; only publication identity/version are assigned. Repeating an identical submission returns its existing PR. `--dry-run` performs no GitHub writes.

## Review and publication

Required checks must validate filenames, references, bounds, denominators, category sums and immutable history, then build the complete website. A result PR may add at most 20 regular JSON reports, each at most 1 MiB, and any required participant URLs. It cannot overwrite, delete or rename a published report, modify scoring definitions, or mix results with application code. Old versions remain downloadable.

Maintainers review the public evidence, reference population, reproducibility information and method identities. Passing CI checks structure and consistency; it does not certify scientific truth. Reviewer approval and passing required checks are prerequisites to merging. A changed PR must be reviewed again.

After merge, Rainbond rebuilds from main. Verify the new result version and JSON download on the live site. A merged PR or successful webhook delivery alone is not proof of publication.

```sh
webstone results status 123 --verify-published
# Another submission won the version number: update this PR and review again.
webstone results rebase 123
```

Rebasing preserves the submitted measurements, updates the publication version against current main and adds a normal merge commit to the contributor's branch. It never force-pushes or edits upstream main. The command only handles the contributor's own open, single-result data PR. It does not replace review.

Corrections and rollbacks are new result versions with explicit explanations. Preserve the source evidence and explain why the corrected version supersedes earlier numbers; do not silently patch history. If resubmitting a previously published result, include the correction/rollback explanation in the result notes so the public record remains clear.

## Public data boundary

All submitted data, including pending PRs, is public. Submit only non-sensitive aggregate results, configurations and public evidence links. Do not include credentials, customer information, private raw logs or large binary artifacts. Keep those outside Git; this repository is not an archive of evaluation worker directories.

## Repository settings

Protect main with at least one reviewer approval and the `Result submission contract` and `Website build` checks. Dismiss stale approvals after updates and disallow direct pushes, force pushes and deletion. These are repository settings; committing a workflow or this document alone does not enable them. The required result check runs the trusted base-branch validator on Git blobs from the candidate, not code supplied by a result contributor. PR jobs have read-only permissions and no deployment credentials.
