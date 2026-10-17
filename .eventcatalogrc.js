// Linter config. Channels, REST queries and message summaries are generated from the
// bounded-context contracts, so owner/summary gaps there are fixed in the contracts (or
// by enriching the generated page), not as blocking errors here.
export default {
  rules: {
    'best-practices/summary-required': 'warn',
  },
  overrides: [
    // REST queries are rendered from the OpenAPI files attached to their <ctx>-api service.
    { files: ['domains/**/queries/**'], rules: { 'best-practices/schema-required': 'off' } },
    { files: ['channels/**'], rules: { 'best-practices/owner-required': 'off', 'best-practices/summary-required': 'off' } },
  ],
};
