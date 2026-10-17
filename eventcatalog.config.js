import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

import { CONTEXTS, SUBDOMAINS as SUBDOMAIN_META } from './catalog.contexts.mjs';
import { apiServiceMarkdown, domainMarkdown, eventsServiceMarkdown, messageMarkdown } from './catalog.markdown.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const spec = (ctx, file) => path.join(__dirname, '.generated-specs', ctx, file);

// Bounded contexts per subdomain live in catalog.contexts.mjs.
// Specs are synced from each repo's origin/develop by scripts/sync-specs.sh.
const contextsOf = (subdomain) => Object.entries(CONTEXTS).filter(([, c]) => c.subdomain === subdomain).map(([id]) => id);
const SUBDOMAINS = Object.fromEntries(
  Object.entries(SUBDOMAIN_META).map(([id, meta]) => [id, { ...meta, contexts: contextsOf(id) }]),
);

const title = (ctx) => ctx.split('-').map((w) => (w === 'wes' ? 'WES' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const OWNERS = ['claudioed'];
const domainFor = (id, { name }) => ({ id, name, version: '1.0.0', owners: OWNERS, generateMarkdown: () => domainMarkdown(id) });
const summaryOf = (ctx) => CONTEXTS[ctx].purpose.split(/(?<=\.)\s/)[0];
const reportsSpec = (ctx) => (fs.existsSync(spec(ctx, 'openapi-reports.yaml')) ? [spec(ctx, 'openapi-reports.yaml')] : []);

const asyncapiGenerators = Object.entries(SUBDOMAINS).map(([id, sd]) => [
  '@eventcatalog/generator-asyncapi',
  {
    services: sd.contexts.map((ctx) => ({ id: ctx, name: `${title(ctx)} (events)`, summary: summaryOf(ctx), path: spec(ctx, 'asyncapi.yaml'), owners: OWNERS, generateMarkdown: eventsServiceMarkdown })),
    domain: domainFor(id, sd),
    messages: { generateMarkdown: messageMarkdown },
    parseChannels: true,
    saveParsedSpecFile: true,
  },
]);

const openapiGenerators = Object.entries(SUBDOMAINS).map(([id, sd]) => [
  '@eventcatalog/generator-openapi',
  {
    services: sd.contexts.map((ctx) => ({ id: `${ctx}-api`, name: `${title(ctx)} API`, summary: `REST API of ${ctx}. ${summaryOf(ctx)}`, generateMarkdown: apiServiceMarkdown, path: [spec(ctx, 'openapi.yaml'), ...reportsSpec(ctx)], owners: OWNERS })),
    domain: domainFor(id, sd),
    sidebarBadgeType: 'HTTP_METHOD',
    // operationIds repeat across services (getHealthz, ...); keep message ids globally unique.
    messages: { id: { prefixWithServiceId: true } },
  },
]);

/** @type {import('@eventcatalog/core/bin/eventcatalog.config').Config} */
export default {
  title: 'Warehouse Systems Ecosystem',
  tagline:
    'Event-driven architecture of the warehouse-systems ecosystem: WMS and WES domains, their bounded-context services, REST contracts and CloudEvents 1.0 messages on Kafka.',
  organizationName: 'Warehouse Systems',
  theme: 'sunset',
  homepageLink: 'https://github.com/IQVO',
  // Supports static or server. Static renders a static site, server renders a server side rendered site
  // large catalogs may benefit from server side rendering
  output: 'static',
  // By default set to false, add true to get urls ending in /
  trailingSlash: false,
  // Change to make the base url of the site different, by default https://{website}.com/docs,
  // changing to /company would be https://{website}.com/company/docs,
  base: '/',
  // Resource search is the default lightweight search. Change this to { type: 'indexed' }
  // to enable full-content search. Indexed search requires running a build to generate the index.
  search: {
    type: 'resource',
  },
  // Customize the navigation for your docs sidebar.
  // read more at https://eventcatalog.dev/docs/development/customization/customize-sidebars/documentation-sidebar
  navigation: {
    pages: ['list:all'],
  },
  // Customize the logo, add your logo to public/ folder
  logo: {
    alt: 'Warehouse Systems',
    src: '/logo.png',
    text: 'Warehouse Systems',
  },
  // This lets you copy markdown contents from EventCatalog to your clipboard
  // Including schemas for your events and services
  llmsTxt: {
    enabled: true,
  },
  // Architecture reference: every build writes architecture.html to your build output, your whole
  // catalog as one HTML file you can share, attach or host. Uncomment this to turn it off.
  // exports: {
  //   html: { enabled: false },
  // },
  generators: [...asyncapiGenerators, ...openapiGenerators],
  // required random generated id used by eventcatalog
  cId: 'f047ad66-5d28-4c16-961a-0e1cebafe682',
  // required by eventcatalog
  tsd: 1792234971968,
};
