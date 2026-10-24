#!/usr/bin/env node
// Orphan integration-event sensor (Phase 7.2).
//
// Fails when an INTEGRATION event type (a CloudEvents type declared on a channel
// ending `.events` — never `.analytics`/`.dlq`) has no consumer anywhere in the
// fleet AND carries no written reason for having none.
//
// Derivation (same convention as scripts/prepare-specs.mjs / catalog.contexts.mjs):
//   PRODUCED  a type whose own segment (com.warehouse.<sub>.<segment>...) is
//             declared on a channel the context OWNS (CONTEXTS[ctx].topics).
//   CONSUMED  a type declared on a channel in a context's spec that the context
//             does NOT own — consumers re-declare the foreign channel with the
//             message types they dispatch on, so a foreign-channel declaration
//             is a declared consumer.
// The own-segment rule for the produced side keeps prose mentions of foreign
// types on owned channels (e.g. a reply type quoted in a description) from
// counting as production.
//
// Reason sources, in priority order:
//   1. `x-no-consumer-reason` on the producer's message (native, preferred)
//   2. `x-no-consumer-reason` on the producer's channel declaration (fallback)
//   3. specs/no-consumer-reasons.yaml allowlist (full type -> reason), the
//      hand-maintained bridge until producer repos carry the extension natively.
//
// The derivation is exported as derive() and reused by catalog.markdown.mjs to
// render the no-consumer notice on event pages, so the CI check and the catalog
// can never disagree about which types carry a reason.
//
// Usage: node scripts/check-orphan-events.mjs [--json] [--reasoned]
//   --json      machine-readable report on stdout
//   --reasoned  also list reasoned (excused) orphans, informationally
// Exit 0 when every orphan carries a reason, 1 otherwise. Clean tree with no
// flags prints nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { CONTEXTS } from '../catalog.contexts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join(ROOT, 'specs');
const ALLOWLIST_FILE = path.join(SPECS, 'no-consumer-reasons.yaml');

const TYPE_RE = /^com\.(warehouse|retailnetwork)\.([a-z-]+)\.([a-z-]+)\.([a-zA-Z]+)\.([A-Z][A-Za-z0-9]+)$/;
const REASON_KEY = 'x-no-consumer-reason';

// com.<org>.<sub>.<segment> -> context key. Type segments equal the context
// key except wes-work-planning, whose types use `work-planning`. The sub group
// is the warehouse subdomain (wms|wes) or the retail-network tier
// (commerce|logistics|partner) — only the segment identifies the context.
const SEGMENT_TO_CTX = Object.fromEntries(Object.keys(CONTEXTS).map((ctx) => [ctx, ctx]));
SEGMENT_TO_CTX['work-planning'] = 'wes-work-planning';

// --- YAML walking -----------------------------------------------------------

// Resolve a local `#/...` pointer; returns undefined on anything else/broken.
function resolveRef(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = doc;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part];
    if (node === undefined) return undefined;
  }
  return node;
}

// CloudEvents types from STRUCTURAL positions only: `type: {const|enum}` in a
// payload schema and `type: <literal>` in an example payload. Description,
// summary and title prose is skipped, so a type quoted in a description never
// counts as a declaration.
function structuralTypes(node, doc, seen = new Set()) {
  const out = new Set();
  const walk = (n) => {
    if (n && typeof n === 'object' && typeof n.$ref === 'string') {
      if (seen.has(n.$ref)) return;
      seen.add(n.$ref);
      return walk(resolveRef(doc, n.$ref));
    }
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    for (const [key, value] of Object.entries(n)) {
      if (key === 'description' || key === 'summary' || key === 'title') continue;
      if (key === 'type') {
        if (typeof value === 'string' && TYPE_RE.test(value)) out.add(value);
        if (value && typeof value === 'object') {
          if (typeof value.const === 'string' && TYPE_RE.test(value.const)) out.add(value.const);
          if (Array.isArray(value.enum)) {
            for (const e of value.enum) if (typeof e === 'string' && TYPE_RE.test(e)) out.add(e);
          }
        }
      }
      walk(value);
    }
  };
  walk(node);
  return out;
}

// Message objects declared on a channel, refs resolved. AsyncAPI 2.6 hangs them
// off publish/subscribe `.message` (single or oneOf); AsyncAPI 3 off
// `channels.<id>.messages`. Direction in the file is unreliable fleet-wide, so
// both operations are read.
function channelMessages(body, doc) {
  const out = [];
  const push = (m) => {
    if (!m || typeof m !== 'object') return;
    if (typeof m.$ref === 'string') {
      const resolved = resolveRef(doc, m.$ref);
      if (resolved) out.push(resolved);
      return;
    }
    if (Array.isArray(m.oneOf)) return m.oneOf.forEach(push);
    out.push(m);
  };
  for (const op of ['publish', 'subscribe']) push(body?.[op]?.message);
  if (body?.messages && typeof body.messages === 'object') Object.values(body.messages).forEach(push);
  return out;
}

// --- Derivation -------------------------------------------------------------

// Scans specs/ once and returns the full orphan analysis. Pure read: no output,
// no exit — importing this module never runs the CLI (see main() guard below).
export function derive() {
  const warnings = [];
  const warn = (msg) => warnings.push(msg);

  const produced = new Map(); // type -> { ctx, channels: Set, messageReason, channelReason }
  const consumers = new Map(); // type -> Set<ctx>

  for (const ctx of fs.existsSync(SPECS) ? fs.readdirSync(SPECS).sort() : []) {
    const specFile = path.join(SPECS, ctx, 'asyncapi.yaml');
    if (!fs.existsSync(specFile)) {
      if (CONTEXTS[ctx]) warn(`specs/${ctx} has no asyncapi.yaml`);
      continue;
    }
    if (!CONTEXTS[ctx]) warn(`specs/${ctx} is not a context in catalog.contexts.mjs`);
    const doc = load(fs.readFileSync(specFile, 'utf8'));
    const owned = new Set(CONTEXTS[ctx]?.topics ?? []);
    for (const [key, body] of Object.entries(doc.channels ?? {})) {
      // 2.6 files key channels by their topic; AsyncAPI 3 files may key them by
      // any name with the topic in `address`. Resolve to the topic address so
      // ownership and the `.events`/`.analytics` suffix tests see the real topic.
      const channel = typeof body?.address === 'string' ? body.address : key;
      const isOwned = owned.has(channel);
      const channelReason = body?.[REASON_KEY];
      for (const message of channelMessages(body, doc)) {
        for (const type of structuralTypes(message, doc)) {
          const segment = TYPE_RE.exec(type)?.[3];
          if (isOwned) {
            if (SEGMENT_TO_CTX[segment] !== ctx) {
              // Foreign type quoted on an owned channel: not this context's
              // production (and not a declared consumption either).
              warn(`${ctx}: foreign type ${type} on owned channel ${channel} ignored`);
              continue;
            }
            const entry = produced.get(type) ?? { ctx, channels: new Set(), messageReason: undefined, channelReason: undefined };
            entry.channels.add(channel);
            if (!entry.messageReason && typeof message[REASON_KEY] === 'string') entry.messageReason = message[REASON_KEY];
            if (!entry.channelReason && typeof channelReason === 'string') entry.channelReason = channelReason;
            produced.set(type, entry);
          } else {
            if (!consumers.has(type)) consumers.set(type, new Set());
            consumers.get(type).add(ctx);
          }
        }
      }
    }
  }
  for (const ctx of Object.keys(CONTEXTS)) {
    if (!fs.existsSync(path.join(SPECS, ctx, 'asyncapi.yaml'))) warn(`context ${ctx} has no synced spec under specs/`);
  }

  // --- Reasons --------------------------------------------------------------

  let allowlist = {};
  if (fs.existsSync(ALLOWLIST_FILE)) {
    const parsed = load(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) allowlist = parsed;
    else warn(`${path.relative(ROOT, ALLOWLIST_FILE)} is not a type -> reason mapping`);
  } else {
    warn(`${path.relative(ROOT, ALLOWLIST_FILE)} missing: no allowlist fallback available`);
  }

  const reasonFor = (type, entry) => {
    if (entry.messageReason) return { reason: entry.messageReason, source: 'message-extension' };
    if (entry.channelReason) return { reason: entry.channelReason, source: 'channel-extension' };
    const allowed = allowlist[type];
    if (typeof allowed === 'string' && allowed.trim()) return { reason: allowed.trim(), source: 'allowlist' };
    return null;
  };

  // --- Orphans --------------------------------------------------------------

  const integration = [...produced.entries()]
    .map(([type, entry]) => ({
      type,
      producer: entry.ctx,
      integrationChannels: [...entry.channels].filter((c) => c.endsWith('.events')).sort(),
      otherChannels: [...entry.channels].filter((c) => !c.endsWith('.events')).sort(),
      consumerContexts: [...(consumers.get(type) ?? [])].filter((c) => c !== entry.ctx).sort(),
    }))
    .filter((e) => e.integrationChannels.length > 0)
    .sort((a, b) => a.producer.localeCompare(b.producer) || a.type.localeCompare(b.type));

  const withConsumers = integration.filter((e) => e.consumerContexts.length > 0);
  const orphans = integration.filter((e) => e.consumerContexts.length === 0);
  const reasoned = [];
  const unreasoned = [];
  for (const orphan of orphans) {
    const r = reasonFor(orphan.type, produced.get(orphan.type));
    (r ? reasoned : unreasoned).push(r ? { ...orphan, ...r } : orphan);
  }

  // Allowlist hygiene: entries that no longer excuse anything are stale.
  const orphanTypes = new Set(orphans.map((o) => o.type));
  for (const type of Object.keys(allowlist).sort()) {
    if (!orphanTypes.has(type)) warn(`allowlist entry for ${type} matches no current orphan (stale?)`);
  }

  return { integration, withConsumers, orphans, reasoned, unreasoned, warnings, allowlist };
}

// --- CLI --------------------------------------------------------------------

function main() {
  const { integration, withConsumers, orphans, reasoned, unreasoned, warnings } = derive();
  const json = process.argv.includes('--json');
  const showReasoned = process.argv.includes('--reasoned');

  if (json) {
    console.log(
      JSON.stringify(
        {
          specs: fs
            .readdirSync(SPECS)
            .filter((c) => fs.existsSync(path.join(SPECS, c, 'asyncapi.yaml'))).length,
          integrationTypes: integration.length,
          withConsumers: withConsumers.length,
          orphans: { total: orphans.length, reasoned: reasoned.length, unreasoned: unreasoned.length },
          unreasoned: unreasoned.map(({ type, producer, integrationChannels }) => ({ type, producer, channels: integrationChannels })),
          reasoned: reasoned.map(({ type, producer, reason, source }) => ({ type, producer, reason, source })),
          warnings,
        },
        null,
        2,
      ),
    );
  } else if (unreasoned.length || showReasoned) {
    for (const { type, producer, integrationChannels } of unreasoned) {
      console.log(`ORPHAN  ${type}`);
      console.log(`        produced by ${producer} on ${integrationChannels.join(', ')}; no consumer declared in any fleet spec and no ${REASON_KEY}`);
    }
    if (showReasoned) {
      for (const { type, reason, source } of reasoned) console.log(`REASONED ${type} — ${reason} [${source}]`);
    }
    if (unreasoned.length) {
      console.log('');
      console.log(`orphan integration events: ${orphans.length} (reasoned: ${reasoned.length}, MISSING reason: ${unreasoned.length})`);
    }
  }
  for (const w of warnings) console.error(`warning: ${w}`);

  if (unreasoned.length > 0) {
    console.error(`${unreasoned.length} integration event type(s) have no consumer and no written reason.`);
    process.exit(1);
  }
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
