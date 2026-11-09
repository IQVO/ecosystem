// Single source of truth for which bounded contexts the catalog documents.
// Used by eventcatalog.config.js, catalog.markdown.mjs and scripts/prepare-specs.mjs.
//
// `subdomain`       EventCatalog domain. For the warehouse fleet the subdomain key is
//                   also the CloudEvents type segment: com.warehouse.<subdomain>.<context>.<entity>.<Event>.
//                   Retail-network contexts set `ceSegment` (commerce|logistics|partner) because
//                   their type segment is the tier, not the domain: com.retailnetwork.<tier>.<context>...
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
  'retail-network': {
    name: 'Retail Network',
    typeOrg: 'retailnetwork',
    typePattern: 'com.retailnetwork.<tier>.<bounded-context>.<entity>.<EventName> (tier = commerce | logistics | partner)',
    summary: 'The retail fulfillment network: a separate organization owning the customer, the catalogue, the delivery promise, order sourcing and the parcel network.',
    description:
      'The Retail Network is a separate organization from the warehouse-systems fleet. It owns the shopper-facing commerce tier (offer, promise, order, sourcing), the parcel logistics tier (topology, linehaul, last mile, tracking) and the partner tier (the Vendor API and node performance). Fulfillment nodes are operated by vendors; the warehouse-systems fleet is one of them (vendor V-WS). The boundary is hard: no retail-network context consumes a warehouse.* topic or calls a warehouse-systems service, and the fleet never consumes a retailnetwork.* topic — the only bridge is vendor-connectivity\'s Vendor API (Open Host Service + Published Language), called by the fleet\'s network-fulfillment context.',
  },
  storefront: {
    name: 'Digital Storefront',
    typeOrg: 'retailnetwork',
    typePattern: 'com.retailnetwork.storefront.<bounded-context>.<entity>.<EventName>',
    summary: 'The digital storefront: a separate domain inside the retail-network organization that owns what a shopper sees, holds in a cart, pays and is charged.',
    description:
      'The Digital Storefront is a separate domain (own model, cadence and docs) inside the retail-network organization. It owns product content, pricing and delivery charges, product discovery, the shopping cart, the checkout purchase saga and customer payments. It may consume retailnetwork.* topics and call the network\'s Open Host Service routes; it never touches a warehouse.* topic, a warehouse-systems service or dataset, and the network never depends on the storefront. PII (ship-to address, names, e-mail) lives only in customer-ordering: the storefront stores shopperId and shipToAddressId references, and never sees a card number, only payment-provider tokens. The storefront-bff (the only storefront edge, REST only, no events) and the payment-provider-simulator (stand-in for the external payment provider) are experience and test-double components, not bounded contexts, and are not catalogued here.',
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
  'dock-scheduling': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "Owns the door calendar of every site: every booked time window on every dock door, inbound and outbound, from booking through arrival to door release, the no-double-booking rule, door opening hours and closures, ETA-driven risk and no-shows.",
    topics: ["warehouse.dock-scheduling.events", "warehouse.dock-scheduling.analytics"],
  },
  'yard-management': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "Owns everything physically on site outside the four walls: who passed the gate (visits), which trailer is where (spot, door or an open move), its load, seal and hold state, the moves hostlers and visiting drivers make, door work at the door, and yard checks. The source of dwell, door occupancy and yard truck productivity facts.",
    topics: ["warehouse.yard-management.events", "warehouse.yard-management.analytics"],
  },
  'outbound-shipping': {
    subdomain: 'wms',
    classification: 'Supporting',
    tier: 'WMS',
    purpose:
      "Gets every manifested package onto the right load before its cutoff, proves what left on which trailer, and tells the fleet that an order has actually shipped: staging, the outbound load, ship-confirm on the trailer's physical departure, and the bill of lading.",
    topics: ["warehouse.outbound-shipping.events", "warehouse.outbound-shipping.analytics"],
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
  // --- Retail Network (separate organization; see SUBDOMAINS['retail-network']) ---
  'node-topology': {
    subdomain: 'retail-network',
    ceSegment: 'logistics',
    classification: 'Supporting',
    tier: 'Retail Network, logistics tier',
    purpose:
      "The authoritative registry of the network's physical shape: every node (vendor fulfillment centres, cross-docks, returns centres, and the network's own sortation centres, delivery stations and air hubs), its declared operational profile, the directed lanes between nodes, the regions, and which delivery station serves which postal area.",
    topics: ["retailnetwork.node-topology.events"],
  },
  'offer-availability': {
    subdomain: 'retail-network',
    ceSegment: 'commerce',
    classification: 'Supporting',
    tier: 'Retail Network, commerce tier',
    purpose:
      "Knows what the network can sell and from which node: the catalogue item, one listing per (catalogue item, node), and the quantity each node currently claims it can ship, with the basis the vendor gave for that number (physical stock or throughput-constrained).",
    topics: ["retailnetwork.offer-availability.events"],
  },
  'delivery-promise': {
    subdomain: 'retail-network',
    ceSegment: 'commerce',
    classification: 'Core',
    tier: 'Retail Network, commerce tier',
    purpose:
      "Tells a shopper, before and at purchase, the date a package will arrive, and makes that date true by construction: a delivery offer is quoted only from a feasible witness path (node cutoff, scheduled departures, delivery wave) that has remaining capacity, and a promise holds that capacity until the order is placed or the hold expires. Judges every promise kept or broken.",
    topics: ["retailnetwork.delivery-promise.events", "retailnetwork.delivery-promise.analytics"],
  },
  'customer-ordering': {
    subdomain: 'retail-network',
    ceSegment: 'commerce',
    classification: 'Generic',
    tier: 'Retail Network, commerce tier',
    purpose:
      "Turns a shopper's cart into a customer order: obtains a promise for every shipment group at checkout, records the order with the shopper and ship-to address (synthetic PII, held only here), shows status and tracking, and handles customer cancellation.",
    topics: ["retailnetwork.customer-ordering.events"],
  },
  'order-sourcing': {
    subdomain: 'retail-network',
    ceSegment: 'commerce',
    classification: 'Core',
    tier: 'Retail Network, commerce tier',
    purpose:
      "Decides, as late as the promise allows, which node and path will actually fulfil each shipment group. Keeps assignments in a virtual queue, re-optimises them against current capacity and cost until the release point, sends the group to the node, reassigns on rejection or expiry, and locks the assignment once the node commits.",
    topics: ["retailnetwork.order-sourcing.events", "retailnetwork.order-sourcing.analytics"],
  },
  'vendor-connectivity': {
    subdomain: 'retail-network',
    ceSegment: 'partner',
    classification: 'Supporting',
    tier: 'Retail Network, partner tier',
    purpose:
      "The network's Open Host Service for vendors that operate fulfillment nodes. Publishes the Vendor API and its Published Language: vendors register nodes, declare their operational profile, send inventory feeds, poll purchase orders, acknowledge them in full inside the acknowledgement window, request labels and confirm shipment. Every write is an asynchronous transaction a vendor reconciles.",
    topics: ["retailnetwork.vendor-connectivity.events", "retailnetwork.vendor-connectivity.analytics"],
  },
  'linehaul-transportation': {
    subdomain: 'retail-network',
    ceSegment: 'logistics',
    classification: 'Supporting',
    tier: 'Retail Network, logistics tier',
    purpose:
      "Runs the middle mile: turns lanes into scheduled departures (including a pickup departure at every vendor node cutoff), keeps each departure's remaining capacity, builds loads of packages onto departures, and reports when loads depart and arrive.",
    topics: ["retailnetwork.linehaul-transportation.events", "retailnetwork.linehaul-transportation.analytics"],
  },
  'last-mile-delivery': {
    subdomain: 'retail-network',
    ceSegment: 'logistics',
    classification: 'Supporting',
    tier: 'Retail Network, logistics tier',
    purpose:
      "Runs each delivery station: publishes delivery waves (induct cutoff, delivery window, stop capacity) that the promise relies on, plans routes for delivery service partners, and records every delivery attempt.",
    topics: ["retailnetwork.last-mile-delivery.events", "retailnetwork.last-mile-delivery.analytics"],
  },
  'shipping-and-tracking': {
    subdomain: 'retail-network',
    ceSegment: 'logistics',
    classification: 'Generic',
    tier: 'Retail Network, logistics tier',
    purpose:
      "Issues shipping labels (the only place outside customer-ordering that ever sees a ship-to address) and owns each package's journey: one customer-visible timeline consolidated from vendor handover, load and delivery facts, ending in delivered, returned or lost.",
    topics: ["retailnetwork.shipping-and-tracking.events"],
  },
  'node-performance': {
    subdomain: 'retail-network',
    ceSegment: 'partner',
    classification: 'Supporting',
    tier: 'Retail Network, partner tier',
    purpose:
      "Measures every node against what it declared and what was asked of it: acknowledgement latency, rejections, on-time handover against requiredShipBy, promise-kept rate and inventory feed freshness, over rolling windows, and grades the node.",
    topics: ["retailnetwork.node-performance.events", "retailnetwork.node-performance.analytics"],
  },
  'seller-inbound': {
    subdomain: 'retail-network',
    ceSegment: 'partner',
    classification: 'Supporting',
    tier: 'Retail Network, partner tier',
    purpose:
      "The seller-facing front door for stock coming into the network: sellers are onboarded and held to a compliance tier, inbound plans are confirmed, and shipments are labelled, shipped and received with discrepancies recorded. Quantities are always eaches; seller-lifecycle and plan facts go to the analytics stream only (G41-54).",
    topics: ["retailnetwork.seller-inbound.events", "retailnetwork.seller-inbound.analytics"],
  },
  // --- Digital Storefront (domain inside the retail-network organization; see SUBDOMAINS.storefront) ---
  'product-content': {
    subdomain: 'storefront',
    classification: 'Generic',
    tier: 'Digital Storefront, storefront tier',
    purpose:
      "Enriches the network's catalogue item with everything a product page needs and the item master does not have: description, bullets, attributes, media and the category tree. The title stays the item master's; media upload is out of scope (URLs to static assets only).",
    topics: ["retailnetwork.product-content.events"],
  },
  'pricing': {
    subdomain: 'storefront',
    classification: 'Core',
    tier: 'Digital Storefront, storefront tier',
    purpose:
      "Owns what a shopper pays: the list price and sale windows per catalogue item, the delivery charge per service tier, a synthetic tax table, and the binding, immutable, expiring PriceQuote a checkout session is confirmed against. One configured currency, integer minor units; promotions are a later phase (D10).",
    topics: ["retailnetwork.pricing.events", "retailnetwork.pricing.analytics"],
  },
  'product-discovery': {
    subdomain: 'storefront',
    classification: 'Supporting',
    tier: 'Digital Storefront, storefront tier',
    purpose:
      "The read side of browsing and search: one ProductView per catalogue item (title, flags, content, categoryId, list and effective price, inStock, purchasable; the category path is joined from CategoryView at query time) and one CategoryView (tree plus purchasable counts), fed by events from offer-availability, product-content and pricing, searched with PostgreSQL full-text search and pg_trgm (D9), behind a port so a dedicated engine is a later adapter swap.",
    topics: [],
  },
  'shopping-cart': {
    subdomain: 'storefront',
    classification: 'Supporting',
    tier: 'Digital Storefront, storefront tier',
    purpose:
      "Holds a shopper's intent: cart lines, the destination postal prefix, the delivery quote delivery-promise returned for the cart (per shipment group, with its offers and expiry), the shopper's tier selection per group, and a labelled, non-binding estimate (effective prices + selected tier charges + tax band) so the total cost is visible up front.",
    topics: ["retailnetwork.shopping-cart.analytics"],
  },
  'checkout': {
    subdomain: 'storefront',
    classification: 'Supporting',
    tier: 'Digital Storefront, storefront tier',
    purpose:
      "The purchase saga: one transaction across price, payment and the network's promise confirmation. Authorize before placing the order (compensatable: void), place the order (pivot), then retriable steps via events. PLACING is the semantic lock: while the place-order outcome is unknown there is no void and no new attempt. Holds shopperId and shipToAddressId references, never PII; the stored placement request is PII-free so it can be replayed byte for byte.",
    topics: ["retailnetwork.checkout.events", "retailnetwork.checkout.analytics"],
  },
  'customer-payments': {
    subdomain: 'storefront',
    classification: 'Generic',
    tier: 'Digital Storefront, storefront tier',
    purpose:
      "Moves money with the shipment facts: authorize at checkout, capture each shipment group's allocation when it ships, release on cancellation, refund on lost or returned packages, re-authorize uncaptured allocations before the provider's authorization validity expires. Speaks to the payment provider through an Anti-Corruption Layer port (Authorize, Capture, Void, Refund, Reauthorize); the payment-provider-simulator is the stand-in adapter and swapping it for a real provider changes nothing else. Never sees a card number, only PSP tokens.",
    topics: ["retailnetwork.customer-payments.events"],
  },
};
