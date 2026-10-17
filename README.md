# ecosystem

[EventCatalog](https://github.com/event-catalog/eventcatalog) for the warehouse-systems ecosystem: the architecture
map of every bounded context, its REST API and the CloudEvents 1.0 messages it publishes and consumes on Kafka.

```
domains/wms/   WMS  - facility-layout, inbound-receiving, inventory-storage, product-master, slotting-optimization
domains/wes/   WES  - fulfillment-execution, labor-performance, network-fulfillment, network-inventory-planning,
                      order-management, process-path-management, warehouse-planning, wes-work-planning,
                      workforce-management
channels/      one page per Kafka topic (warehouse.<ctx>.events | .analytics)
users/         owners
```

Each context is two services: `<ctx>` (events, from `apis/asyncapi.yaml`) and `<ctx>-api` (REST, from
`apis/openapi.yaml` + `apis/openapi-reports.yaml`).

## Workflow

```bash
npm run sync       # copy apis/*.yaml from each repo's origin/develop into specs/  (WAREHOUSE_ROOT, default ..)
npm run generate   # specs/ -> .generated-specs/ -> domains/ + channels/
npm run lint       # eventcatalog-linter
npm run dev        # http://localhost:3000
npm run build      # static site in build/
```

`specs/` is a byte-for-byte copy of each repo's contract and is committed, so builds never depend on a stale
worktree. `scripts/prepare-specs.mjs` writes a normalised copy to `.generated-specs/` (git-ignored) because the
fleet's AsyncAPI 2.6 files lack `messageId`, use publish/subscribe inconsistently and re-declare consumed channels;
the header of that script documents each rewrite. Payload schemas are never modified.

## Adding a context

1. Add it to `catalog.contexts.mjs` (subdomain + the Kafka topics it **publishes**).
2. `npm run sync && npm run generate`.

## Notes

- Generated pages are committed so they can be enriched by hand (`preserveExistingMessages` keeps edits on regenerate).
- Every endpoint is unauthenticated fleet-wide; the catalog documents no auth scheme.
- `process-path-management-scalability` is a worktree of `process-path-management` and is not documented separately.
- Contexts without an `apis/asyncapi.yaml` (provisioning, task-interleaving, pick-face-replenishment) are not in the catalog yet.
- EventCatalog 5.x is Business Source License 1.1 with a 60-day trial (see https://www.eventcatalog.dev/license-faq).
