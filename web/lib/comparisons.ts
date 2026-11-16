import type { Benchmark, Metric, Provider } from "./results.ts";

export function overviewMetrics(metrics: Metric[], primary: string): Metric[] {
  const quality = metrics.filter(item => ["ratio", "percent", "score"].includes(item.unit) && !item.signed);
  const median = metrics.find(item => /p50/i.test(item.id));
  const resource = metrics.find(item => item.unit === "mib");
  const price = metrics.find(item => item.unit === "usd");
  const candidates = [metrics.find(item => item.id === primary), ...quality.slice(0, 3), median ?? resource, price];
  const chosen = [...new Map(candidates.filter((item): item is Metric => Boolean(item)).map(item => [item.id, item])).values()];
  return chosen.slice(0, 5);
}

export function qualityMetrics(benchmark: Benchmark) {
  return benchmark.metrics.filter(item => ["ratio", "percent", "score"].includes(item.unit) && !item.signed && item.direction === "desc");
}

export function qualityScale(metric: Metric) {
  return metric.chartRange?.[1] ?? (metric.unit === "ratio" ? 1 : 100);
}

export function categoryRate(provider: Provider, id: string, total: number): number | null {
  const passed = provider.categoryPassed?.[id];
  return passed == null || total <= 0 ? null : passed / total;
}
