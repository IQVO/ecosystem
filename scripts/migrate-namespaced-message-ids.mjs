#!/usr/bin/env node
// One-shot, idempotent migration of COMMITTED catalog pages to producer-namespaced
// message ids (scripts/prepare-specs.mjs step 8: `<ctx>-<Event>`).
//
// The generators preserve committed page bodies and merge a service's existing
// sends/receives into the regenerated ones, so switching the id scheme by
// regenerating alone would leave every bare-id page and reference behind. This
// script rewrites the tree first, keeping hand-written bodies and versioned history:
//   1. every event page dir `domains/<dom>/services/<svc>/events/<Id>` is renamed to
//      the namespaced id and the `id:` of its index.mdx (current + versioned/*) is
//      rewritten;
//   2. every events service's `sends`/`receives` (current + versioned/*) is rewritten:
//      sends -> `<svc>-<Id>`, receives -> `<producer of the from-channel>-<Id>`;
//   3. `nginx.legacy-event-ids.map` maps each bare id that had a page to its new id,
//      so old /docs/events/<Id>/... URLs keep working (301, see nginx.conf).
// Needs a fresh `.generated-specs/` (`npm run prepare-specs`): the namespaced ids
// that will exist are read from there. Usage: node scripts/... [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { CONTEXTS } from '../catalog.contexts.mjs';

const DRY = process.argv.includes('--dry-run');
const GEN = '.generated-specs';
const MAP_FILE = 'nginx.legacy-event-ids.map';
const BARE = /^[A-Z][A-Za-z0-9]*$/;

// --- ids that the next generate will write -------------------------------------
const genIds = new Set();
for (const ctx of fs.readdirSync(GEN)) {
  const f = path.join(GEN, ctx, 'asyncapi.yaml');
  if (!fs.existsSync(f)) continue;
  const doc = load(fs.readFileSync(f, 'utf8'));
  const v2 = String(doc.asyncapi).startsWith('2.');
  for (const [k, m] of Object.entries(doc.components?.messages ?? {})) genIds.add(v2 ? m.messageId : k);
  if (!v2) for (const ch of Object.values(doc.channels ?? {})) for (const k of Object.keys(ch?.messages ?? {})) genIds.add(k);
}
const byBase = new Map();
for (const id of genIds) {
  const base = id.replace(/^[a-z0-9-]+?-(?=[A-Z])/, '');
  byBase.set(base, [...(byBase.get(base) ?? []), id]);
}

// --- topic ownership (same rule as prepare-specs step 8) ------------------------
const TOPIC_PRODUCER = {};
for (const [ctx, { topics }] of Object.entries(CONTEXTS)) for (const t of topics) TOPIC_PRODUCER[t] = ctx;
const producerOf = (ctx, topic) => {
  if (CONTEXTS[ctx]?.topics?.includes(topic)) return ctx;
  if (TOPIC_PRODUCER[topic]) return TOPIC_PRODUCER[topic];
  const named = /^(?:warehouse|retailnetwork)\.([a-z0-9-]+)\./.exec(topic)?.[1];
  return named && CONTEXTS[named] ? named : ctx;
};
// channel page id -> topic (AsyncAPI 3 channel ids are friendly keys; 2.6 ids are topics)
const channelTopic = {};
for (const dir of fs.existsSync('channels') ? fs.readdirSync('channels') : []) {
  const f = path.join('channels', dir, 'index.mdx');
  if (!fs.existsSync(f)) continue;
  const fm = frontmatter(fs.readFileSync(f, 'utf8'));
  if (fm?.id) channelTopic[fm.id] = fm.address ?? fm.id;
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? load(m[1]) : undefined;
}
const resolve = (bare, preferred) => {
  if (genIds.has(`${preferred}-${bare}`)) return `${preferred}-${bare}`;
  const c = byBase.get(bare) ?? [];
  return c.length === 1 ? c[0] : undefined;
};
const indexFiles = (dir) => {
  const out = [];
  if (fs.existsSync(path.join(dir, 'index.mdx'))) out.push(path.join(dir, 'index.mdx'));
  const v = path.join(dir, 'versioned');
  if (fs.existsSync(v)) for (const ver of fs.readdirSync(v)) if (fs.existsSync(path.join(v, ver, 'index.mdx'))) out.push(path.join(v, ver, 'index.mdx'));
  return out;
};
const write = (f, text) => { if (!DRY) fs.writeFileSync(f, text); };

// --- 1. event page dirs -----------------------------------------------------------
const services = [];
for (const dom of fs.readdirSync('domains')) {
  const sd = path.join('domains', dom, 'services');
  if (fs.existsSync(sd)) for (const svc of fs.readdirSync(sd)) services.push({ svc, dir: path.join(sd, svc) });
}
const pageMap = new Map(); // bare id -> new id of the page that held it as current
const taken = new Set();
const report = { renamedDirs: 0, ambiguous: [], refs: 0, unresolvedRefs: [] };
for (const { svc, dir } of services) {
  const ev = path.join(dir, 'events');
  if (!fs.existsSync(ev)) continue;
  for (const bare of fs.readdirSync(ev).sort()) {
    if (!BARE.test(bare)) continue; // already namespaced
    let next = resolve(bare, svc);
    if (!next) report.ambiguous.push(`${svc}/events/${bare} -> ${(byBase.get(bare) ?? []).join(',') || 'retired'}`);
    if (!next || taken.has(next)) next = `${svc}-${bare}`;
    taken.add(next);
    const from = path.join(ev, bare);
    const hasCurrent = fs.existsSync(path.join(from, 'index.mdx'));
    if (hasCurrent && !pageMap.has(bare)) pageMap.set(bare, next);
    for (const f of indexFiles(from)) {
      const text = fs.readFileSync(f, 'utf8');
      write(f, text.replace(new RegExp(`^(---\\n(?:[\\s\\S]*?\\n)?)id: ${bare}\\n`), `$1id: ${next}\n`));
    }
    if (!DRY) fs.renameSync(from, path.join(ev, next));
    report.renamedDirs++;
  }
}

// --- 2. sends / receives -----------------------------------------------------------
for (const { svc, dir } of services) {
  for (const f of indexFiles(dir)) {
    const text = fs.readFileSync(f, 'utf8');
    const end = text.indexOf('\n---', 4);
    const lines = text.slice(0, end).split('\n');
    let block = null;
    for (let i = 0; i < lines.length; i++) {
      const top = /^([A-Za-z]+):/.exec(lines[i]);
      if (top) { block = top[1]; continue; }
      const entry = /^  - id: (\S+)$/.exec(lines[i]);
      if (!entry || (block !== 'sends' && block !== 'receives') || !BARE.test(entry[1])) continue;
      const bare = entry[1];
      let channel;
      for (let j = i + 1; j < lines.length && !/^ {0,2}\S/.test(lines[j]); j++) {
        const c = /^ {6}- id: (\S+)$/.exec(lines[j]);
        if (c) { channel = c[1]; break; }
      }
      const producer = block === 'sends' ? svc : channel ? producerOf(svc, channelTopic[channel] ?? channel) : undefined;
      const next = (producer && resolve(bare, producer)) ?? pageMap.get(bare);
      if (!next) { report.unresolvedRefs.push(`${f}: ${block} ${bare}`); continue; }
      lines[i] = `  - id: ${next}`;
      report.refs++;
    }
    write(f, lines.join('\n') + text.slice(end));
  }
}

// --- 3. legacy URL map ----------------------------------------------------------------
const legacy = new Map();
if (fs.existsSync(MAP_FILE)) {
  for (const l of fs.readFileSync(MAP_FILE, 'utf8').split('\n')) {
    const m = /^\s*(\S+)\s+(\S+);$/.exec(l);
    if (m) legacy.set(m[1], m[2]);
  }
}
for (const [bare, next] of pageMap) if (!legacy.has(bare)) legacy.set(bare, next);
const body = [...legacy].sort(([a], [b]) => a.localeCompare(b)).map(([a, b]) => `${a} ${b};`).join('\n');
write(
  MAP_FILE,
  `# Bare message id -> producer-namespaced id (scripts/migrate-namespaced-message-ids.mjs).\n` +
    `# Keeps pre-namespacing /docs/events/<Id>/... URLs alive; nginx.conf answers them with a 301.\n` +
    `# Frozen legacy table: new events are namespaced from the start and never need an entry.\n${body}\n`,
);
console.log(JSON.stringify({ dryRun: DRY, ...report, legacyIds: legacy.size }, null, 2));
