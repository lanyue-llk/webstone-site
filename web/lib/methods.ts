import { canonicalVersion, compareVersions, type Catalog, type Provider, type Snapshot } from './results.ts';

export function methodIdentity(catalog: Catalog, providerId: string) {
  const method = catalog.methods.find(method => method.providerIds.includes(providerId));
  if (!method) throw new Error(`Unknown method identity: ${providerId}`);
  return method;
}

// Only the latest edition of each benchmark contributes to current coverage.
export function methodResults(catalog: Catalog, snapshots: Snapshot[], providerId: string) {
  const method = methodIdentity(catalog, providerId);
  return catalog.benchmarks.flatMap(benchmark => {
    const snapshot = snapshots.filter(s => s.benchmarks.some(b => b.id === benchmark.id))
      .sort((a,b) => compareVersions(a.version,b.version)).at(-1);
    const result = snapshot?.benchmarks.find(b => b.id === benchmark.id);
    return (result?.providers ?? []).filter(provider => method.providerIds.includes(provider.id)).map((provider: Provider) => ({
      benchmark, provider, resultId: snapshot!.id, version: canonicalVersion(snapshot!.version), reportUrl: result!.reportUrl ?? benchmark.reportUrl,
    }));
  });
}
