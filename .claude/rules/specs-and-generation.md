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
