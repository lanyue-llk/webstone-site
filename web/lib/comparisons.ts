import type { Benchmark, Metric, Provider } from "./results.ts";

export function decisionMetrics(benchmark: Benchmark, expanded: boolean, selected: string): Metric[] {
  if (expanded) return benchmark.metrics;
  return benchmark.metrics.filter(metric => metric.id === benchmark.primaryMetric || metric.id === selected
    || benchmark.leadingMetricIds?.includes(metric.id)
    || ["seconds", "ms", "mib", "usd"].includes(metric.unit));
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

export const searchBillingUnits = ["requests", "successful searches"] as const;

export function searchBillingUnit(provider: Provider) {
  const unit = provider.billingDescription?.match(/per 1,000 (requests|successful searches)\b/i)?.[1]?.toLowerCase();
  return searchBillingUnits.find(option => option === unit);
}

export function costBounds(provider: Provider, metric?: Metric): [number, number] | null {
  if (!metric) return quotedCost(provider);
  const amount = provider.scores[metric.id];
  return amount === null || amount === undefined ? null : [amount, amount];
}

export function hasComparableChartCosts(providers: Provider[], metric?: Metric): boolean {
  return metric?.highlightBest !== false && providers.some(provider => costBounds(provider, metric) !== null);
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
