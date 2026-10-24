// Page bodies for generated catalog resources. The generators only emit the spec text and a
// graph; these templates add what a reader needs to place a resource: what it is for, where it
// sits in the DDD map, which topics it publishes/consumes and how its messages are enveloped.
import { CONTEXTS, SUBDOMAINS } from './catalog.contexts.mjs';
import { derive } from './scripts/check-orphan-events.mjs';

const REPO = (ctx) => `https://github.com/IQVO/${ctx}`;
const code = (s) => '`' + s + '`';

// Types excused from having a consumer, from the same derivation the CI sensor
// runs (native `x-no-consumer-reason` on the producer, or the
// specs/no-consumer-reasons.yaml allowlist). Cached: one scan per generate,
// not one per event page. A reason starting with `pending:` is transitional
// and renders verbatim.
let noConsumerByType;
function noConsumerReasonFor(type) {
  if (!noConsumerByType) {
    noConsumerByType = new Map(derive().reasoned.map((r) => [r.type, r.reason]));
  }
  return type ? noConsumerByType.get(type) : undefined;
}

// Same rule as the generators: leave code spans/blocks alone, escape what breaks MDX elsewhere.
export function escapeMdx(text = '') {
  const kept = [];
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    kept.push(m);
    return `__CODE_${kept.length - 1}__`;
  });
  return masked
    .replace(/\{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/</g, '&lt;')
    .replace(/__CODE_(\d+)__/g, (_, i) => kept[Number(i)]);
}

const table = (rows) => rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n');

// CloudEvents naming per organization: warehouse types are
// com.warehouse.<subdomain>.<ctx>…, retail-network types are
// com.retailnetwork.<tier>.<ctx>… (the tier is the type segment, not the domain).
const ceOrg = (c) => SUBDOMAINS[c.subdomain]?.typeOrg ?? 'warehouse';
const ceSegment = (c) => c.ceSegment ?? c.subdomain;

const consumedTopics = (ctx, document) => {
  const own = new Set(CONTEXTS[ctx].topics);
  return [...document.channels().all()].map((c) => c.id()).filter((id) => !own.has(id));
};

export function domainMarkdown(id) {
  const sd = SUBDOMAINS[id];
  const rows = Object.entries(CONTEXTS)
    .filter(([, c]) => c.subdomain === id)
    .map(([ctx, c]) => `| [${ctx}](/docs/services/${ctx}) | ${c.classification} | ${c.tier} | ${escapeMdx(c.purpose)} |`);
  return `## Overview
${sd.description}

CloudEvents types in this domain follow \`${sd.typePattern ?? `com.warehouse.${id}.<bounded-context>.<entity>.<EventName>`}\`.
Each bounded context below is documented twice: as an **events** service (the Kafka contract, from its
AsyncAPI file) and as a **REST API** service (\`<context>-api\`, from its OpenAPI files, including the
separate \`*-reports\` analytics binary where one exists).

## Bounded contexts
| Context | Classification | Tier | Purpose |
|---|---|---|---|
${rows.join('\n')}

## Architecture diagram
<NodeGraph />
`;
}

export function eventsServiceMarkdown({ service, markdown, document }) {
  const ctx = service.id;
  const c = CONTEXTS[ctx];
  const consumed = consumedTopics(ctx, document);
  return `## Purpose
${escapeMdx(c.purpose)}

| | |
|---|---|
${table([
  ['Bounded context', code(ctx)],
  ['Domain', `${SUBDOMAINS[c.subdomain].name} (${code(c.subdomain)})`],
  ['DDD classification', c.classification],
  ['Tier', c.tier],
  ['Publishes (Kafka)', c.topics.map(code).join('<br/>')],
  ['Consumes (Kafka)', consumed.length ? consumed.map(code).join('<br/>') : 'nothing: this context is a pure publisher'],
  ['CloudEvents type prefix', code(`com.${ceOrg(c)}.${ceSegment(c)}.${ctx}.`)],
  ['Event source', code(`/${ceOrg(c)}/${ctx}`)],
  ['Repository', `[IQVO/${ctx}](${REPO(ctx)})`],
  ['REST API', `[${ctx}-api](/docs/services/${ctx}-api)`],
])}

Every message is a CloudEvents 1.0 structured-mode JSON document (\`application/cloudevents+json\`).
\`<ctx>.events\` topics carry the integration contract; \`<ctx>.analytics\` topics carry projector input for the
context's own reports and are never consumed by another context.

## Contract
${markdown}`;
}

export function apiServiceMarkdown({ service, markdown }) {
  const ctx = service.id.replace(/-api$/, '');
  const c = CONTEXTS[ctx];
  return `## Purpose
${escapeMdx(c.purpose)}

| | |
|---|---|
${table([
  ['Bounded context', code(ctx)],
  ['Domain', `${SUBDOMAINS[c.subdomain].name} (${code(c.subdomain)})`],
  ['DDD classification', c.classification],
  ['Tier', c.tier],
  ['Repository', `[IQVO/${ctx}](${REPO(ctx)})`],
  ['Events', `[${ctx}](/docs/services/${ctx})`],
])}

This service groups the context's synchronous surface: the OLTP REST API (\`openapi.yaml\`) and, where the
context has one, the separate read-only reports API (\`openapi-reports.yaml\`) served by its \`*-reports\`
binary from an isolated analytical database. Endpoints are unauthenticated fleet-wide.
${markdown}`;
}

export function messageMarkdown({ message, markdown }) {
  // Description arrives pre-escaped from scripts/prepare-specs.mjs (step 7);
  // escaping here again would double the backslashes.
  const description = message.hasDescription() ? message.description() : '';
  const example = message.examples().all()[0];
  const payload = example?.payload?.();
  const type = payload?.type;
  const dataschema = payload?.dataschema;
  const channelIds = message.channels().all().map((ch) => ch.id());
  const channels = channelIds.map(code);
  const tags = (message.tags().all() || []).map((t) => t.name());
  // The notice states a fact about the type's INTEGRATION publication: only
  // the `.events` channel page carries it. The `.analytics` mirror has its own
  // consumer (the context's projector) and must not show it. AsyncAPI 3 channel
  // ids are friendly keys — fall back to the channel address for the suffix test.
  const chans = message.channels().all();
  const onEventsChannel = chans.some((ch) => ch.id().endsWith('.events') || String(ch.address?.() ?? '').endsWith('.events'));
  const noConsumer = onEventsChannel ? noConsumerReasonFor(type) : undefined;
  const rows = [
    type && ['CloudEvents `type`', code(type)],
    payload?.source && ['CloudEvents `source`', code(payload.source)],
    payload?.subject && ['CloudEvents `subject`', 'the id of the aggregate instance the event is about (example: ' + code(String(payload.subject)) + ')'],
    dataschema && ['CloudEvents `dataschema`', code(dataschema)],
    message.contentType() && ['Content type', code(message.contentType())],
    channels.length && ['Kafka topic', [...new Set(channels)].join('<br/>')],
    tags.length && ['Entity / aggregate', tags.map(code).join(', ')],
  ].filter(Boolean);
  return `${description ? `## Description\n${description}\n` : ''}${noConsumer ? `> **No consumer by design:** ${escapeMdx(noConsumer)}\n` : ''}
${rows.length ? `## Envelope\n| | |\n|---|---|\n${table(rows)}\n` : ''}
${markdown}`;
}
