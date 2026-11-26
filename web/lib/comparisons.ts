import type { Benchmark, Metric, Provider } from "./results.ts";

export function decisionMetrics(benchmark: Benchmark, expanded: boolean, selected: string): Metric[] {
  const disclosed = benchmark.metrics.filter(metric => metric.id === benchmark.primaryMetric
    || benchmark.providers.some(provider => typeof provider.scores[metric.id] === "number"));
  const keyIds = benchmark.keyMetricIds ?? [benchmark.primaryMetric];
  const key = keyIds.flatMap(id => disclosed.filter(metric => metric.id === id));
  const extra = disclosed.filter(metric => !keyIds.includes(metric.id));
  return [...key, ...(expanded ? extra : extra.filter(metric => metric.id === selected))];
}

// Never turn unknown, software-only, or ranged billing into a point price.
export function quotedCost(provider: Provider): [number, number] | null {
  const pricing = provider.pricing;
  if (pricing && pricing.min !== null && pricing.min !== undefined && pricing.max !== null && pricing.max !== undefined) return [pricing.min, pricing.max];
  return null;
}

export function hasPricingInformation(provider: Provider): boolean {
  const softwareCost = provider.pricing?.softwareCost;
  return quotedCost(provider) !== null || (softwareCost !== null && softwareCost !== undefined);
}

export function costBounds(provider: Provider, metric?: Metric): [number, number] | null {
  if (!metric) return quotedCost(provider);
  const amount = provider.scores[metric.id];
  return amount === null || amount === undefined ? null : [amount, amount];
}

export function qualityMetrics(benchmark: Benchmark) {
  return benchmark.metrics.filter(item => ["ratio", "percent", "score"].includes(item.unit) && !item.signed && item.direction === "desc");
}

export function qualityScale(metric: Metric) {
  return metric.chartRange?.[1] ?? (metric.unit === "ratio" ? 1 : 100);
}

export function categoryRate(provider: Provider, id: string, total: number): number | null {
  const passed = provider.categoryPassed?.[id];
  return passed === null || passed === undefined || total <= 0 ? null : passed / total;
}
