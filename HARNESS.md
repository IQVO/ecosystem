# HARNESS.md — ecosystem

What agent harness this repo has, what each piece runs, and when. Model (from
`warehouse-harness-template`, after Böckeler, "Harness engineering for coding agent users"):
**guides** steer an agent before it acts (feedforward), **sensors** report after it acts (feedback);
each is **computational** (deterministic) or **inferential** (LLM). This is the fleet's EventCatalog
(a generated static site over committed contract copies), not a Go bounded context: there is no
coverage gate, arch-test, bdd, mutation, api-lint or docs-api-drift here. Only what is listed below
exists.

harness-template: v4

## Guides (feedforward)

| File | Type | Purpose |
|---|---|---|
| `CLAUDE.md` (`AGENTS.md` is a symlink to it) | computational | Entry point: what the catalog is, the license secret rule, the spec-copy and generation rules, commands. |
| `.claude/rules/specs-and-generation.md` | computational | Scoped to `specs/**`, `scripts/**`, `domains/**`, `channels/**`, the catalog config: byte copies, prepare-specs, regeneration, the orphan sensor. |
| `.claude/rules/fleet/readme-standard.md` | computational | Fleet README standard (copied from the template). |
| `.claude/agents/*.md` | inferential | `code-review`, `architecture-review`, `domain-review` subagents (template-managed). |
| `.claude/memory/MEMORY.md` | computational | Durable repo heuristics that are not incidents. |
| `INCIDENTS.md` | computational | Fleet incident log: every escape with its fix and the sensor that now guards it. |

## Sensors (feedback)

| Sensor | Where | What it runs | Lifecycle | Blocking? |
|---|---|---|---|---|
| `guide-lint` | `.github/workflows/ci.yml` | `guide_lint.py` (skills load, cited paths and `make` targets exist, context budget), `repo_lint.py` (workflow paths, `needs:`, Dependabot, stale owner, placeholders), `test_hook.py`, `test_red_issue.py`, `test_repo_lint.py` | PR + push to develop/main | yes |
| `lint` | ci.yml | `npm run lint` (eventcatalog-linter) | PR + push | yes |
| `build` | ci.yml | `npm run build`: prepare-specs + full static build without `license.jwt`; uploads `dist/` | PR + push | yes |
| `helm` | ci.yml | `helm lint charts/ecosystem` | PR + push | yes |
| `orphan-events` | `.github/workflows/orphan-events.yml` | `npm run check:events`: every integration event type has a consumer or a written reason | PRs/pushes touching `specs/**`, the sensor, `catalog.contexts.mjs` | yes |
| `specs-fresh` | `.github/workflows/specs-fresh.yml` | `scripts/test_check_specs_fresh.py`, then `scripts/check-specs-fresh.py`: every `specs/` copy equals its producer's develop | every PR, push to develop, nightly | yes |
| `specs-refresh` (healer) | `.github/workflows/specs-refresh.yml` | `scripts/specs-refresh.sh` (sync, orphan sensor, generate, lint, build, re-sync) against the producers' develop; on drift opens/updates the bot PR `chore/specs-refresh` and dispatches its checks | 4x a day + manual | no (it fixes what specs-fresh reports) |
| CodeQL | `.github/workflows/codeql.yml` | JavaScript analysis | PR, push, weekly | yes |
| AI review | `.github/workflows/ai-review.yml` | needs `ANTHROPIC_API_KEY`; path filter `internal/domain`, `apis`, `charts` (fires on `charts/**` here) | PR into develop | no (advisory) |

`docker-publish` (push to main or a `v*` tag: GHCR, cosign, SBOM) and the manual `license-debug` job are
delivery/diagnostics, not sensors. `specs-fresh` can go red on a PR that did not touch `specs/` when a
producer merges a contract change meanwhile: never weaken the check. The `specs-refresh` workflow
answers it within hours with the bot PR `chore/specs-refresh` (merge it on green, then `update-branch`
the red PRs); `scripts/specs-refresh.sh` is the same refresh by hand. Flow and the token/setting it
needs: `.claude/rules/specs-and-generation.md`.

Local gates: `make check-fast` (lint; the agent Stop hook runs it), `make check` / `make check-all`
(lint + build), `make chart-lint`, `make guide-lint`, `make harness-test`, `npm run check:events`.

## Agent runtime harness

| Piece | Files | Lifecycle |
|---|---|---|
| Guard + feedback hooks | `scripts/harness/hook.py` (`pre` / `post` / `stop`) with adapters `.claude/settings.json`, `.codex/hooks.json`, `.opencode/plugins/harness.ts` | every tool call; end of turn |
| Skills for Codex | `.agents/skills` symlink to `.claude/skills` (no repo skills yet) | on task match |
| Red-sensor helper | `scripts/harness/red_issue.py` (tested; no scheduled job here calls it yet) | n/a |

The hooks block pushes to develop/main, `--no-verify`, force-push, bare `rm -rf` on non-scratch
paths, destructive git, and edits to generated files; the Stop hook runs `make check-fast` when code
changed. `HARNESS_OFF=1` disables them. The `scripts/harness/*.py` files and the three adapters are
template-managed copies: change them in `warehouse-harness-template`, never here. The license guard
(no `*.jwt` tracked) is a rule in `CLAUDE.md`, not a hook.

## Incident protocol

Every failure that was not caught before CI ends with the fix, a sensor or guide that would have
caught it, that sensor rolled out fleet-wide, and a row in [INCIDENTS.md](INCIDENTS.md). A row with
no guard is an open gap and says so.
