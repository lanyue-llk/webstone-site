import type { Benchmark, Metric, Provider } from "./results.ts";

// Never turn unknown, software-only, or ranged billing into a point price.
export function quotedCost(provider: Provider): [number, number] | null {
  const pricing = provider.pricing;
  if (pricing?.min != null && pricing.max != null) return [pricing.min, pricing.max];
  return null;
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
