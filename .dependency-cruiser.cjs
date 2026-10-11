/**
 * Enforces the layering agreed with the client: business logic stays independent of the framework.
 *
 *   domain          → nothing (pure TypeScript)
 *   application     → domain
 *   infrastructure  → application, domain
 *   apps/*          → anything (composition roots)
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment: 'packages/domain must not import other layers, apps or any npm package.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: { pathNot: '^packages/domain/src' },
    },
    {
      name: 'application-depends-only-on-domain',
      comment: 'packages/application may import packages/domain only (no framework, DB or SDKs).',
      severity: 'error',
      from: { path: '^packages/application/src' },
      to: { pathNot: '^packages/(application|domain)/src' },
    },
    {
      name: 'infrastructure-not-into-apps',
      severity: 'error',
      from: { path: '^packages/infrastructure/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|\\.wrangler|routeTree\\.gen\\.ts|\\.test\\.ts$)' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'] },
  },
}
