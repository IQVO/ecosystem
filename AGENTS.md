<!-- BEGIN:eventcatalog-agent-rules -->
# EventCatalog: ALWAYS read docs before coding

Before any EventCatalog work, find and read the relevant doc in `node_modules/@eventcatalog/core/dist/docs/`. Your training data may be outdated. The bundled docs are the source of truth.

<!-- END:eventcatalog-agent-rules -->

## Secrets: the EventCatalog license must never reach GitHub

- `license.jwt` (offline EventCatalog license, IQVO, community plan) lives in the catalog root and is **git-ignored** (`license.jwt` and `*.jwt` in `.gitignore`). Never commit, stage, copy into the repo history, paste into a PR, issue or chat, or print its contents.
- Never remove or loosen those `.gitignore` entries, never `git add -f license.jwt`, and never run `git add -A` / `git commit -a` without first checking `git status` shows no `*.jwt`.
- Before any commit or push, run `git ls-files | grep -i -E 'jwt|license'`; it must print nothing.
- In CI, write the file during the job from a secret, or point `EC_LICENSE` at a path outside the checkout. Do not bake it into an image or a build artifact (`build/`, `dist/`, `Dockerfile` layers).
- If it is ever committed or pushed: stop, tell the user, request a new license from hello@eventcatalog.dev, and scrub history (`git filter-repo`) before anything else.
