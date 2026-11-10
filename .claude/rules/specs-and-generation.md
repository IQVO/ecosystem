---
paths:
  - "specs/**"
  - "scripts/**"
  - "domains/**"
  - "channels/**"
  - "catalog.contexts.mjs"
  - "catalog.markdown.mjs"
  - "eventcatalog.config.js"
---

# Spec copies, generation and the orphan sensor

## `specs/` is a byte copy, never an edit

- `npm run sync` (`scripts/sync-specs.sh`) copies each registered context's `apis/*.yaml` from that
  repo's `origin/develop` into `specs/<ctx>/`. `WAREHOUSE_ROOT` defaults to `..`; in a worktree set it
  to the directory that holds the sibling repos or contexts are silently skipped.
- Never hand-edit a file under `specs/<ctx>/`. A wrong contract is fixed by a PR into the producer
  repo, then re-synced. The `specs-fresh` workflow (`scripts/check-specs-fresh.py`) fails a PR when any
  copy differs from its producer's develop, so a busy producer can turn it red on a PR that never
  touched that context: re-sync, do not work around it.
- `scripts/prepare-specs.mjs` writes a normalised copy to `.generated-specs/` (git-ignored): injected
  message ids, per-channel clones, direction rewritten from topic ownership, MDX escaping. Its header
  documents each rewrite. Payload schemas are never modified.

## Self-healing refresh (`specs-refresh` workflow, bot PR `chore/specs-refresh`)

- `scripts/specs-refresh.sh` is the whole sanctioned refresh as one command: `npm run sync`, the orphan
  sensor, `npm run generate` (fails on any `Failed to parse` line and on empty directories), `rm -rf .astro`,
  `npm run lint`, `npm run build`, re-sync, and the re-sync must find the bytes generate used. Exit 0
  (prints `NO-DRIFT` when there was nothing to do), 1 a step failed, 3 a producer moved mid-run (run again).
  Run it locally instead of chaining the steps by hand (`WAREHOUSE_ROOT` as for sync).
- `.github/workflows/specs-refresh.yml` runs it four times a day and on `workflow_dispatch`, against shallow
  clones of every registered producer's develop. Drift: it commits `specs/`, `domains/`, `channels/` on top of
  develop as `chore/specs-refresh` (force-with-lease; the branch belongs to the job, never push to it), and
  opens or updates ONE PR into develop. No drift: it closes a leftover bot PR. A failed step leaves no PR.
- GITHUB_TOKEN pushes and PRs trigger no workflows, so without a `SPECS_REFRESH_TOKEN` secret the job
  dispatches `ci.yml`, `specs-fresh.yml` and `orphan-events.yml` on the bot branch; their check runs land on
  the PR head and satisfy branch protection. With the secret (fine-grained PAT or GitHub App token,
  contents + pull requests write) the normal `pull_request` runs fire instead. Opening the PR with
  GITHUB_TOKEN needs the repository setting "Allow GitHub Actions to create and approve pull requests";
  without it the job pushes the branch and fails with an error naming that setting.
- Merging stays a human/agent decision: review the contract diff, squash-merge on green, then
  `update-branch` the PRs that were red on specs-fresh. `specs-fresh` itself is unchanged and blocking:
  the bot is the fix it asks for, never a reason to make it advisory.

## Generation

- `npm run generate` regenerates `domains/` and `channels/` from `.generated-specs/`. It takes
  minutes: run it to completion (a killed run leaves half-written event directories that break the
  Astro build).
- Committed page bodies are preserved on regenerate, so hand enrichment survives and stale prose
  survives too: fix stale text on the current page, never in a `versioned/` copy.
- `domains/operator-experience/` is hand-written: never delete `domains/` wholesale.
- Registering a context = an entry in `catalog.contexts.mjs` (subdomain + the topics it PUBLISHES);
  `catalog.markdown.mjs` writes domain/service/message bodies from it.

## Orphan events (`npm run check:events`)

- `scripts/check-orphan-events.mjs` fails on any integration event type (a `.events` channel) with no
  declared consumer and no written reason. Reasons go native in the producer contract
  (`x-no-consumer-reason`); `specs/no-consumer-reasons.yaml` is only for contracts that cannot be
  edited and holds no entries today.
- Run it unpiped: a pipe hides its exit code.

## CloudEvents

Every documented message is a CloudEvents 1.0 structured event; the catalog documents the
envelope, it never defines a second one. No auth scheme is documented: the fleet is unauthenticated.
