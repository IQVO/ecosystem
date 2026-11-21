// Derive generator input from the synced contracts in ./specs -> ./.generated-specs
//
// ./specs stays a byte-for-byte copy of each repo's origin/develop contract. This step
// writes a normalised COPY that @eventcatalog/generator-asyncapi can digest. It never
// touches schemas or payloads; it only adds/rewires catalog metadata:
//
//  1. messageId   The 2.6 contracts define messages under components.messages without
//                 `messageId`; the generator keys catalog messages on message.id(), which
//                 the parser only derives from `messageId`. We add PascalCase(component key)
//                 (unique per file; keeps *Analytics / *Integration variants distinct).
//  2. clones      The parser needs a unique messageId per message occurrence. When one
//                 component is referenced from several channels (integration + analytics),
//                 each extra channel gets a clone suffixed by its stream (…Analytics).
//  3. direction   The fleet's 2.6 files use publish/subscribe inconsistently (facility-layout
//                 publishes via `subscribe`, labor-performance consumes via `subscribe`), and
//                 the generator derives sends/receives from it. Topic ownership
//                 (catalog.contexts.mjs) is the reliable signal: a context sends on topics it
//                 owns and receives on all others.
//  4. v3 ids     AsyncAPI 3 files (network-inventory-planning, retail network) key
//                 messages in camelCase while every 2.6 file yields PascalCase ids;
//                 the catalog keys on the id, so camelCase keys are renamed (and
//                 their $refs rewritten) to line up cross-context. Retail-network
//                 consumer declarations named `Consumed<X>` are renamed to the
//                 owner's `<X>` for the same reason: one message id per event.
//  6. openapi     Path-level `parameters` are copied into each operation (and removed from the
//                 path item): the generator otherwise lists them as a bogus "PARAMETERS" endpoint.
//  5. channels    Several contracts re-declare channels they only consume. The generator
//                 writes channels globally (last writer wins), so every declaration of a topic
//                 is aligned to the OWNER's description and version.
//  7. kafka only  The catalog documents the Kafka contract. A 2.6 channel served only by
//                 non-Kafka servers (asrs-control's MQTT telegram link to the PLC, its ADR 0002)
//                 is dropped from the copy, with the messages only such channels reference and
//                 the servers nothing references any more; ./specs keeps the full contract.
//  8. namespace   Message ids are namespaced by the PRODUCING context: `<ctx>-<Event>`
//                 (e.g. `customer-returns-ReturnAuthorized`), the same `<service>-<id>`
//                 shape generator-openapi's prefixWithServiceId gives the REST messages.
//                 Bounded contexts may reuse an event name (customer-returns and
//                 returns-processing both publish ReturnAuthorized; their CloudEvents
//                 types differ by context), and EventCatalog keys pages on the id alone,
//                 so bare ids merged two contracts into one page. The producer is the
//                 owner of the channel the message is declared on (topic ownership in
//                 catalog.contexts.mjs), so a consumer's re-declaration on a foreign
//                 channel gets the PRODUCER's namespace and its `receives` resolves to the
//                 producer's page. A message without a `title` gets the bare event name
//                 as title, so page names and the sidebar keep reading `ReturnAuthorized`.
//                 Applies to every context, both AsyncAPI versions (2.6: `messageId`;
//                 3.0: the message keys, whose names ARE the ids).
import fs from 'node:fs';
import path from 'node:path';
import { load, dump } from 'js-yaml';
import { CONTEXTS } from '../catalog.contexts.mjs';
import { escapeMdx } from '../catalog.markdown.mjs';

const SRC = 'specs';
const OUT = '.generated-specs';
const pascal = (k) => k.charAt(0).toUpperCase() + k.slice(1);
const isV2 = (doc) => String(doc.asyncapi).startsWith('2.');

const docs = {};
// specs/ also carries non-contract files (e.g. the no-consumer allowlist yaml);
// only context directories with a synced asyncapi.yaml are generator input.
const specDirs = fs
  .readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(SRC, e.name, 'asyncapi.yaml')))
  .map((e) => e.name);
for (const ctx of specDirs) {
  docs[ctx] = load(fs.readFileSync(path.join(SRC, ctx, 'asyncapi.yaml'), 'utf8'));
}
// (7) escape spec prose before any cross-doc copying, so channel descriptions
// handed from owner to consumer are already MDX-safe.
for (const ctx of specDirs) escapeAsyncApiProse(docs[ctx]);

// topic -> { description, version } from the owning context. 2.6 files key
// channels by their topic; AsyncAPI 3 files may key them by any name and carry
// the topic in `address` — resolve both.
const channelByAddress = (doc, topic) =>
  doc?.channels?.[topic] ?? Object.values(doc?.channels ?? {}).find((c) => c?.address === topic);
const topicOwner = {};
for (const [ctx, { topics }] of Object.entries(CONTEXTS)) {
  for (const t of topics) {
    const ch = channelByAddress(docs[ctx], t);
    if (ch) topicOwner[t] = { ctx, description: ch.description, version: String(docs[ctx].info.version) };
  }
}

// (8) topic -> producing context, from catalog.contexts.mjs alone (independent of
// which specs are synced). A topic no context registers falls back to the context
// named in it (`warehouse.<ctx>.analytics`), else to the declaring context itself.
const TOPIC_PRODUCER = {};
for (const [ctx, { topics }] of Object.entries(CONTEXTS)) for (const t of topics) TOPIC_PRODUCER[t] = ctx;
function producerOf(ctx, topic) {
  if (CONTEXTS[ctx]?.topics?.includes(topic)) return ctx;
  if (TOPIC_PRODUCER[topic]) return TOPIC_PRODUCER[topic];
  const named = /^(?:warehouse|retailnetwork)\.([a-z0-9-]+)\./.exec(topic)?.[1];
  return named && CONTEXTS[named] ? named : ctx;
}
const namespaced = (producer, id) => `${producer}-${id}`;

const HTTP = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
function hoistPathParameters(api) {
  for (const item of Object.values(api.paths ?? {})) {
    const shared = item.parameters;
    if (!shared) continue;
    delete item.parameters;
    for (const m of HTTP) {
      if (!item[m]) continue;
      const own = item[m].parameters ?? [];
      const key = (p) => `${p.in}:${p.name}:${p.$ref ?? ''}`;
      const have = new Set(own.map(key));
      item[m].parameters = [...shared.filter((p) => !have.has(key(p))), ...own];
    }
  }
}

//  7. mdx         The EventCatalog generators escape braces in most spec prose
//                 themselves (`\{` works in this MDX toolchain), but their `<`
//                 escape (`\<`) does NOT suppress inline-JSX parsing — a raw
//                 `<slug>` in prose breaks the Astro build even backslashed.
//                 Split responsibilities:
//                 • fields the generator brace-escapes (OpenAPI path prose,
//                   AsyncAPI info/channel): we pre-convert `<` to `&lt;` only,
//                   leaving braces for the generator;
//                 • fields that reach .mdx UNescaped (OpenAPI info, AsyncAPI
//                   message descriptions): full escapeMdx (braces + `&lt;`).
//                 Payload/response SCHEMAS are never touched: they render as JSON.
function mdxEscape(v) {
  return typeof v === 'string' ? escapeMdx(v) : v;
}
function escapeLt(v) {
  if (typeof v !== 'string') return v;
  const kept = [];
  const masked = v.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    kept.push(m);
    return `__LT_${kept.length - 1}__`;
  });
  return masked.replace(/</g, '&lt;').replace(/__LT_(\d+)__/g, (_, i) => kept[Number(i)]);
}
function escapeOpenApiProse(api) {
  if (api.info) {
    api.info.description = mdxEscape(api.info.description);
    api.info.summary = mdxEscape(api.info.summary);
  }
  for (const item of Object.values(api.paths ?? {})) {
    const params = [...(item.parameters ?? [])];
    for (const m of HTTP) {
      const op = item[m];
      if (!op) continue;
      op.description = escapeLt(op.description);
      op.summary = escapeLt(op.summary);
      params.push(...(op.parameters ?? []));
      if (op.requestBody) op.requestBody.description = escapeLt(op.requestBody.description);
      for (const resp of Object.values(op.responses ?? {})) resp.description = escapeLt(resp.description);
    }
    params.forEach((p) => (p.description = escapeLt(p.description)));
  }
}
function escapeAsyncApiProse(doc) {
  if (doc.info) {
    doc.info.description = escapeLt(doc.info.description);
    doc.info.summary = escapeLt(doc.info.summary);
  }
  for (const ch of Object.values(doc.channels ?? {})) ch.description = escapeLt(ch.description);
  for (const msg of Object.values(doc.components?.messages ?? {})) {
    msg.description = mdxEscape(msg.description);
    msg.summary = mdxEscape(msg.summary);
  }
}

function renameV3MessageKeys(ctx, doc) {
  // PascalCase ids fleet-wide; strip a `Consumed` prefix (retail-network consumer
  // declarations) so the event name equals the owner's; then (8) namespace by the
  // producer of the channel the message is declared on.
  const base = (key) => pascal(key).replace(/^Consumed(?=[A-Z])/, '');
  const topicOf = (name, ch) => (typeof ch?.address === 'string' ? ch.address : name);
  const components = doc.components?.messages ?? {};
  const componentProducer = new Map(); // component key -> producer of its first channel
  for (const [name, ch] of Object.entries(doc.channels ?? {})) {
    for (const m of Object.values(ch?.messages ?? {})) {
      const key = /^#\/components\/messages\/(.+)$/.exec(m?.$ref ?? '')?.[1];
      if (key && !componentProducer.has(key)) componentProducer.set(key, producerOf(ctx, topicOf(name, ch)));
    }
  }
  const renames = new Map(); // old $ref -> new $ref
  const rename = (obj, prefix, producerFor) => {
    if (!obj) return;
    const next = {};
    for (const [key, value] of Object.entries(obj)) {
      const producer = producerFor(key);
      // `Consumed<X>` next to the context's own `<X>` would collide; keep the prefix then.
      let id = namespaced(producer, base(key));
      if (Object.hasOwn(next, id)) id = namespaced(producer, pascal(key));
      if (Object.hasOwn(next, id)) throw new Error(`${ctx}: message id ${id} declared twice in ${prefix}`);
      if (value && typeof value === 'object' && !value.$ref && !value.title) value.title = base(key);
      next[id] = value;
      if (id !== key) renames.set(`${prefix}/${key}`, `${prefix}/${id}`);
    }
    for (const key of Object.keys(obj)) delete obj[key];
    Object.assign(obj, next);
  };
  rename(components, '#/components/messages', (key) => componentProducer.get(key) ?? ctx);
  for (const [name, ch] of Object.entries(doc.channels ?? {})) {
    const producer = producerOf(ctx, topicOf(name, ch));
    rename(ch?.messages, `#/channels/${name}/messages`, () => producer);
  }
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && renames.has(node.$ref)) node.$ref = renames.get(node.$ref);
    Object.values(node).forEach(walk);
  };
  walk(doc);
}

function dropNonKafkaChannels(doc) {
  if (!String(doc.asyncapi ?? '').startsWith('2.')) return;
  const servers = doc.servers ?? {};
  const kafka = (name) => /^kafka/.test(servers[name]?.protocol ?? '');
  const refs = (def) => {
    const m = (def.publish ?? {}).message, n = (def.subscribe ?? {}).message;
    return [m, n].flatMap((x) => (x ? (x.oneOf ?? [x]) : []))
      .map((i) => /^#\/components\/messages\/(.+)$/.exec(i.$ref ?? '')?.[1]).filter(Boolean);
  };
  const dropped = new Set(), kept = new Set(), usedServers = new Set();
  for (const [channel, def] of Object.entries(doc.channels ?? {})) {
    const on = def?.servers ?? [];
    if (on.length && !on.some(kafka)) {
      refs(def).forEach((k) => dropped.add(k));
      delete doc.channels[channel];
    } else {
      refs(def).forEach((k) => kept.add(k));
      (on.length ? on : Object.keys(servers)).forEach((n) => usedServers.add(n));
    }
  }
  for (const k of dropped) if (!kept.has(k)) delete doc.components?.messages?.[k];
  for (const n of Object.keys(servers)) if (!kafka(n) && !usedServers.has(n)) delete servers[n];
}

function normalise(ctx, doc) {
  dropNonKafkaChannels(doc);
  const owned = new Set(CONTEXTS[ctx]?.topics ?? []);

  // (4) channel metadata aligned to the owner. AsyncAPI 3 channels may be keyed
  // by any name with the topic in `address` — resolve the topic first.
  for (const [channel, def] of Object.entries(doc.channels ?? {})) {
    const chan = typeof def?.address === 'string' ? def.address : channel;
    const owner = topicOwner[chan];
    if (!owner) continue;
    if (owner.description) def.description = owner.description;
    def['x-eventcatalog-channel-version'] = owner.version;
  }

  if (!isV2(doc)) {
    renameV3MessageKeys(ctx, doc);
    return;
  }
  const messages = doc.components?.messages ?? {};

  // (1) messageId
  for (const [key, msg] of Object.entries(messages)) {
    if (msg && typeof msg === 'object' && !msg.$ref && !msg.messageId) msg.messageId = pascal(key);
  }

  // (3) direction
  const size = (op) => (op?.message ? (op.message.oneOf?.length ?? 1) : 0);
  for (const [channel, def] of Object.entries(doc.channels ?? {})) {
    const ops = ['publish', 'subscribe'].filter((k) => def[k]);
    if (!ops.length) continue;
    const op = def[ops.sort((a, b) => size(def[b]) - size(def[a]))[0]];
    delete def.publish;
    delete def.subscribe;
    def[owned.has(channel) ? 'publish' : 'subscribe'] = op;
  }

  // (2) clones for components referenced from more than one channel
  const seen = new Set();
  for (const [channel, def] of Object.entries(doc.channels ?? {})) {
    // Last segment of a dotted Kafka topic (…events/…analytics) or of a slashed MQTT
    // topic (asrs/v1/{asrsId}/up -> Up); braces would make the clone's $ref invalid.
    const stream = pascal(channel.split(/[./]/).pop().replace(/[{}]/g, ''));
    const m = (def.publish ?? def.subscribe)?.message;
    if (!m) continue;
    for (const item of m.oneOf ?? [m]) {
      const match = /^#\/components\/messages\/(.+)$/.exec(item.$ref ?? '');
      if (!match) continue;
      let key = match[1];
      if (seen.has(key)) {
        const clone = `${key}${stream}`;
        if (!messages[clone]) messages[clone] = { ...messages[key], messageId: `${messages[key].messageId}${stream}` };
        item.$ref = `#/components/messages/${clone}`;
        key = clone;
      }
      seen.add(key);
    }
  }

  // (8) namespace every message id by its producer. Runs after the clones, so each
  // component is referenced from exactly one channel and the clone's id is built
  // from the bare id. Components no channel references get the declaring context.
  const done = new Set();
  const namespace = (key, producer) => {
    const msg = messages[key];
    if (done.has(key) || !msg || typeof msg !== 'object' || msg.$ref || !msg.messageId) return;
    if (!msg.title) msg.title = msg.messageId;
    msg.messageId = namespaced(producer, msg.messageId);
    done.add(key);
  };
  for (const [channel, def] of Object.entries(doc.channels ?? {})) {
    const m = (def.publish ?? def.subscribe)?.message;
    if (!m) continue;
    const producer = producerOf(ctx, channel);
    for (const item of m.oneOf ?? [m]) {
      const key = /^#\/components\/messages\/(.+)$/.exec(item.$ref ?? '')?.[1];
      if (key) namespace(key, producer);
    }
  }
  for (const key of Object.keys(messages)) namespace(key, ctx);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const ctx of specDirs) {
  fs.mkdirSync(path.join(OUT, ctx), { recursive: true });
  for (const file of fs.readdirSync(path.join(SRC, ctx))) {
    if (file === 'asyncapi.yaml') continue;
    const target = path.join(OUT, ctx, file);
    if (!file.startsWith('openapi')) { fs.copyFileSync(path.join(SRC, ctx, file), target); continue; }
    const api = load(fs.readFileSync(path.join(SRC, ctx, file), 'utf8'));
    hoistPathParameters(api);
    escapeOpenApiProse(api);
    fs.writeFileSync(target, dump(api, { lineWidth: -1, noRefs: true }));
  }
  normalise(ctx, docs[ctx]);
  fs.writeFileSync(path.join(OUT, ctx, 'asyncapi.yaml'), dump(docs[ctx], { lineWidth: -1, noRefs: true }));
}
console.log(`prepared ${Object.keys(docs).length} contexts into ${OUT}/`);
