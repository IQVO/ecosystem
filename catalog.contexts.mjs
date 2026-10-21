// Single source of truth for which bounded contexts the catalog documents.
// Used by eventcatalog.config.js, catalog.markdown.mjs and scripts/prepare-specs.mjs.
//
// `subdomain`       CloudEvents type segment: com.warehouse.<subdomain>.<context>.<entity>.<Event>.
// `classification`  DDD strategic classification (from warehouse-docs, docs/contexts/index.md).
// `tier`            Where the context sits in the fleet.
// `purpose`         What the context is for, in business language (shown on its catalog pages).
// `topics`          Kafka topics the context PUBLISHES (it owns their message contracts).
//                   Every other channel in its AsyncAPI file is a topic it CONSUMES.
export const SUBDOMAINS = {
  wms: {
    name: 'WMS',
    summary: 'Warehouse Management System: what is held where, in what state, and how it gets in.',
    description:
      'The WMS tier is the system of record for physical inventory and the facility around it: the layout of the building, the product master, what has been received, where every unit is stowed and what portion of it is usable. WMS contexts publish facts; the WES tier reads them as local copies and never asks WMS synchronously at decision time.',
  },
  wes: {
    name: 'WES',
    summary: 'Warehouse Execution System: planning, releasing and executing work on the floor.',
    description:
      'The WES tier turns demand into work and work into completed tasks: orders arrive, capacity is planned, work is released waveless, tasks are claimed pull-style, labor is assigned and performance is scored. It also owns the edge to the external retail fulfillment network.',
  },
};

export const CONTEXTS = {
  'facility-layout': {
    subdomain: 'wms',
    classification: 'Generic',
    tier: 'WMS-adjacent, extracted',
    purpose:
      "Owns the physical structure of the warehouse: Site, Zone, Aisle and LocationSlot, plus location types, placement rules and geometry. Every other context that needs to know where something can be stored keeps a local copy of this published language.",
    topics: ["warehouse.facility.events", "warehouse.facility.analytics"],
  },
  'inbound-receiving': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "Everything before the first stow: advance ship notices (ASN), dock-door appointments, goods receipt and discrepancy capture. Hands received units to inventory-storage as events.",
    topics: ["warehouse.inbound-receiving.events", "warehouse.inbound-receiving.analytics"],
  },
  'inventory-storage': {
    subdomain: 'wms',
    classification: 'Core',
    tier: 'WMS',
    purpose:
      "Authoritative record of what is held where and how much of it is usable. Implements chaotic (random) stow and makes allocation a revocable reservation, so a failed physical pick never strands an order.",
    topics: ["warehouse.inventory.events", "warehouse.inventory.analytics"],
  },
  'pick-face-replenishment': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "Min/max forward pick-face replenishment: raises requests that move stock from reserve to forward slots, driven by event-fed local copies of stock levels and slot plans.",
    topics: ["warehouse.pick-face-replenishment.events", "warehouse.pick-face-replenishment.analytics"],
  },
  'returns-processing': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "The reverse flow of goods: authorize a return against a shipped order line (RMA), receive and grade it (ReturnReceipt), decide what happens to it (Disposition) and hand restockable units back to inventory-storage as a staged line. An analytics mirror is planned, not built (ADR 0004).",
    topics: ["warehouse.returns-processing.events"],
  },
  'product-master': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "SKU-level product master data: handling classification and physical profile (declared versus measured dimensions and weight). Publishes ProductClassified, which several contexts keep as a local copy.",
    topics: ["warehouse.product-master.events", "warehouse.product-master.analytics"],
  },
  'slotting-optimization': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "Decides which SKUs deserve a forward pick slot: velocity-ranked slot plans and slot moves that a human approves, derived purely from event-fed local copies.",
    topics: ["warehouse.slotting-optimization.events"],
  },
  'exception-management': {
    subdomain: 'wes',
    classification: 'Supporting',
    tier: 'WES',
    purpose:
      "The Problem Solve lifecycle: every case is opened by a fact another context published (CPT misses, diverted packages, weight discrepancies, backlog alarms, network-order risks, unexpected returns, count discrepancies); this service owns the triage, assignment, SLA and resolution of that case, never the producer's own state.",
    topics: ["warehouse.exception-management.events"],
  },
  'fulfillment-execution': {
    subdomain: 'wes',
    classification: 'Core',
    tier: 'WES',
    purpose:
      "Pick, pack and SLAM task lifecycle with pull-based claimNext dispatch and lease semantics. The execution side of the WES: work is claimed by stations and associates, never pushed.",
    topics: ["warehouse.fulfillment.events", "warehouse.fulfillment.analytics"],
  },
  'labor-performance': {
    subdomain: 'wes',
    classification: 'Supporting',
    tier: 'WES, downstream observer',
    purpose:
      "Engineered labor standards and actual-versus-standard performance scoring. Observes task completion from fulfillment-execution; it never drives work.",
    topics: ["warehouse.labor-performance.events", "warehouse.labor-performance.analytics"],
  },
  'network-fulfillment': {
    subdomain: 'wes',
    classification: 'Supporting',
    tier: 'WES, external network edge (anti-corruption layer)',
    purpose:
      "Anti-corruption layer between the fleet and an external retail fulfillment network (Amazon Selling Partner API): network-originated demand, the acknowledgement clock and capacity-aware advertised availability.",
    topics: ["warehouse.network-fulfillment.events", "warehouse.network-fulfillment.analytics"],
  },
  'network-inventory-planning': {
    subdomain: 'wes',
    classification: 'Core',
    tier: 'WES, inter-warehouse transfer planning',
    purpose:
      "SKU placement, inventory balancing and inter-warehouse transfer orchestration: advisory transfer proposals and an operator-approved transfer saga. Fails closed when its local facts are empty or stale.",
    topics: ["warehouse.network-inventory-planning.events", "warehouse.network-inventory-planning.analytics"],
  },
  'order-management': {
    subdomain: 'wes',
    classification: 'Generic/Supporting',
    tier: 'WES, upstream front door',
    purpose:
      "Order intake, allocation, promise dates and release. The front door of the fleet; consumes its upstreams through their published contracts only.",
    topics: ["warehouse.order-management.events", "warehouse.order-management.analytics"],
  },
  'process-path-management': {
    subdomain: 'wes',
    classification: 'Generic',
    tier: 'WES, extracted catalogue',
    purpose:
      "Operator-configurable process-path topology (id, capability requirements, activation lifecycle, CPT schedules), replacing a static YAML catalogue. Source of the process-path published language for the fleet.",
    topics: ["warehouse.process-path-management.events", "warehouse.process-path-management.analytics"],
  },
  'task-interleaving': {
    subdomain: 'wes',
    classification: 'Supporting',
    tier: 'WES',
    purpose:
      "Advisory next-task hints that chain compatible tasks by travel distance, keeping fulfillment-execution pull-based: hints are offered, never imposed.",
    topics: ["warehouse.task-interleaving.events", "warehouse.task-interleaving.analytics"],
  },
  'warehouse-planning': {
    subdomain: 'wes',
    classification: 'Core',
    tier: 'WES, capacity planning',
    purpose:
      "Process and process-path capacity, normalisation across native units, and forward-looking capacity shortage detection.",
    topics: ["warehouse.warehouse-planning.events", "warehouse.warehouse-planning.analytics"],
  },
  'wes-work-planning': {
    subdomain: 'wes',
    classification: 'Core',
    tier: 'WES, the conductor',
    purpose:
      "The core WES context: charge forecasts, waveless release and flow balancing. Decides which work is released to the floor and when.",
    topics: ["warehouse.work-planning.events", "warehouse.wes.analytics"],
  },
  'workforce-management': {
    subdomain: 'wes',
    classification: 'Supporting',
    tier: 'WES',
    purpose:
      "Shift planning and labor assignment. Stops deliberately at the process-path boundary: it assigns people to paths, it does not plan work.",
    topics: ["warehouse.workforce.events", "warehouse.workforce.analytics"],
  },
};
