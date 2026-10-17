// Single source of truth for which bounded contexts the catalog documents.
// Used by eventcatalog.config.js, scripts/prepare-specs.mjs and scripts/sync-specs.sh.
//
// `subdomain` is the CloudEvents type segment: com.warehouse.<subdomain>.<context>.<entity>.<Event>.
// `topics` are the Kafka topics the context PUBLISHES (it owns their message contracts).
// Every other channel in its AsyncAPI file is a topic it CONSUMES.
export const SUBDOMAINS = {
  wms: { name: 'WMS', description: 'Warehouse Management System: what is where, and in what state.' },
  wes: { name: 'WES', description: 'Warehouse Execution System: planning, releasing and executing work.' },
};

export const CONTEXTS = {
  'facility-layout': { subdomain: 'wms', topics: ['warehouse.facility.events', 'warehouse.facility.analytics'] },
  'inbound-receiving': { subdomain: 'wms', topics: ['warehouse.inbound-receiving.events', 'warehouse.inbound-receiving.analytics'] },
  'inventory-storage': { subdomain: 'wms', topics: ['warehouse.inventory.events', 'warehouse.inventory.analytics'] },
  'product-master': { subdomain: 'wms', topics: ['warehouse.product-master.events', 'warehouse.product-master.analytics'] },
  'slotting-optimization': { subdomain: 'wms', topics: ['warehouse.slotting-optimization.events'] },

  'fulfillment-execution': { subdomain: 'wes', topics: ['warehouse.fulfillment.events', 'warehouse.fulfillment.analytics'] },
  'labor-performance': { subdomain: 'wes', topics: ['warehouse.labor-performance.events', 'warehouse.labor-performance.analytics'] },
  'network-fulfillment': { subdomain: 'wes', topics: ['warehouse.network-fulfillment.events', 'warehouse.network-fulfillment.analytics'] },
  'network-inventory-planning': { subdomain: 'wes', topics: ['warehouse.network-inventory-planning.events', 'warehouse.network-inventory-planning.analytics'] },
  'order-management': { subdomain: 'wes', topics: ['warehouse.order-management.events', 'warehouse.order-management.analytics'] },
  'process-path-management': { subdomain: 'wes', topics: ['warehouse.process-path-management.events', 'warehouse.process-path-management.analytics'] },
  'warehouse-planning': { subdomain: 'wes', topics: ['warehouse.warehouse-planning.events', 'warehouse.warehouse-planning.analytics'] },
  'wes-work-planning': { subdomain: 'wes', topics: ['warehouse.work-planning.events', 'warehouse.wes.analytics'] },
  'workforce-management': { subdomain: 'wes', topics: ['warehouse.workforce.events', 'warehouse.workforce.analytics'] },
};
