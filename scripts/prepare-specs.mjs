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
import fs from 'node:fs';
import path from 'node:path';
import { load, dump } from 'js-yaml';
import { CONTEXTS } from '../catalog.contexts.mjs';

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

function renameV3MessageKeys(doc) {
  const renames = new Map(); // old $ref -> new $ref
  const rename = (obj, base) => {
    if (!obj) return;
    for (const key of Object.keys(obj)) {
      // PascalCase ids fleet-wide; strip a `Consumed` prefix (retail-network
      // consumer declarations) so the id equals the owner's message id.
      const next = pascal(key).replace(/^Consumed(?=[A-Z])/, '');
      if (next === key || Object.hasOwn(obj, next)) continue;
      obj[next] = obj[key];
      delete obj[key];
      renames.set(`${base}/${key}`, `${base}/${next}`);
    }
  };
  rename(doc.components?.messages, '#/components/messages');
  for (const [name, ch] of Object.entries(doc.channels ?? {})) rename(ch.messages, `#/channels/${name}/messages`);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && renames.has(node.$ref)) node.$ref = renames.get(node.$ref);
    Object.values(node).forEach(walk);
  };
  walk(doc);
}

function normalise(ctx, doc) {
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
    renameV3MessageKeys(doc);
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
    const stream = pascal(channel.split('.').pop());
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
    fs.writeFileSync(target, dump(api, { lineWidth: -1, noRefs: true }));
  }
  normalise(ctx, docs[ctx]);
  fs.writeFileSync(path.join(OUT, ctx, 'asyncapi.yaml'), dump(docs[ctx], { lineWidth: -1, noRefs: true }));
}
console.log(`prepared ${Object.keys(docs).length} contexts into ${OUT}/`);
