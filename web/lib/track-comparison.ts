import { compareVersions, resolveBenchmark, type Benchmark, type Catalog, type Metric, type Provider, type Snapshot } from './results.ts';
import { qualityMetrics } from './comparisons.ts';

export type ComparisonColumn = { benchmark: Benchmark; metric: Metric; snapshot: Snapshot };
export type ComparisonRow = { id: string; name: string; results: Record<string, { provider: Provider; column: ComparisonColumn }> };

export function trackComparison(catalog: Catalog, snapshots: Snapshot[], trackId: string, layer = 'L1') {
  const track = catalog.tracks.find(track => track.id === trackId && track.overview);
  if (!track) return null;
  const columns: ComparisonColumn[] = catalog.benchmarks.filter(bench => bench.trackId === trackId && (!bench.outputLayer || bench.outputLayer === layer)).flatMap(info => {
    const snapshot = snapshots.filter(s => s.benchmarks.some(b => b.id === info.id)).sort((a,b) => compareVersions(a.version,b.version)).at(-1);
    const result = snapshot?.benchmarks.find(b => b.id === info.id);
    if (!snapshot || !result) return [];
    const benchmark = resolveBenchmark(catalog,result);
    const metric = benchmark.metrics.find(m => m.id === benchmark.primaryMetric)!;
    return [{benchmark,metric,snapshot}];
  });
  if (!columns.length) return null;
  const grouped = new Map<string,ComparisonRow>();
  for (const column of columns) for (const provider of column.benchmark.providers) {
    const group = track.overview?.methodGroups?.find(group => group.providerIds.includes(provider.id));
    const id = group?.id ?? provider.id;
    const row = grouped.get(id) ?? {id,name:group?.name ?? provider.name,results:{}};
    if (row.results[column.benchmark.id]) throw new Error(`Ambiguous overview method: ${trackId}/${id}/${column.benchmark.id}`);
    row.results[column.benchmark.id] = {provider,column};
    grouped.set(id,row);
  }
  const rows = [...grouped.values()].sort((a,b) => Object.keys(b.results).length-Object.keys(a.results).length || a.name.localeCompare(b.name));
  const metrics = columns.flatMap(column => qualityMetrics(column.benchmark).map(metric => ({
    ...metric,id:`${column.benchmark.id}:${metric.id}`,label:`${column.benchmark.name.replace(/^LexBench /,'')} · ${metric.label}`,
  })));
  const providers: Provider[] = rows.map(row => ({
    id:row.id,name:row.name,description:'',mode:'',passed:null,
    scores:Object.fromEntries(columns.flatMap(column => qualityMetrics(column.benchmark).map(metric => [
      `${column.benchmark.id}:${metric.id}`,row.results[column.benchmark.id]?.provider.scores[metric.id] ?? null,
    ]))),
  }));
  const profile: Benchmark = {
    ...columns[0].benchmark,id:`track:${trackId}`,name:track.name,rankable:false,primaryMetric:metrics[0].id,
    metrics,keyMetricIds:metrics.map(metric=>metric.id),categories:[],providers,providerCount:providers.length,
  };
  return {track,columns,rows,profile};
}
