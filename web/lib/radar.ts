import { categoryRate, qualityMetrics, qualityScale } from "./comparisons.ts";
import { formatMetric, type Benchmark, type Metric, type Provider } from "./results.ts";

type Bounds = [number, number];
type Axis = {
  id: string;
  label: string;
  value: (provider: Provider) => Bounds | null;
  display: (provider: Provider) => string;
};

function point(value: number | null | undefined): Bounds | null {
  return value === null || value === undefined ? null : [value, value];
}

function metricAxis(metric: Metric): Axis {
  return {
    id: metric.id,
    label: metric.label,
    value: provider => point(provider.scores[metric.id]),
    display: provider => formatMetric(provider.scores[metric.id], metric.unit, metric.decimals),
  };
}

function resourceAxis(axis: Axis, providers: Provider[]): Axis | null {
  const values = providers.flatMap(provider => axis.value(provider) ?? []);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = (value: number) => {
    if (min > 0) return min / value;
    if (max > 0) return 1 - value / max;
    return 1;
  };

  return {
    ...axis,
    value(provider) {
      const bounds = axis.value(provider);
      return bounds ? [scale(bounds[1]), scale(bounds[0])] : null;
    },
  };
}

export function radarAxes(benchmark: Benchmark, categories = false): Axis[] {
  if (categories) return benchmark.categories.map(category => ({
    id: category.id,
    label: category.name,
    value: provider => point(categoryRate(provider, category.id, category.total)),
    display: provider => {
      const passed = provider.categoryPassed?.[category.id];
      return typeof passed === "number" ? `${passed} / ${category.total}` : "—";
    },
  }));

  const hasValues = (metric: Metric) => benchmark.providers.some(provider => typeof provider.scores[metric.id] === "number");
  const quality = qualityMetrics(benchmark).filter(hasValues)
    .sort((a, b) => Number(b.id === benchmark.primaryMetric) - Number(a.id === benchmark.primaryMetric));
  const timing = benchmark.metrics.filter(metric => ["ms", "seconds"].includes(metric.unit) && hasValues(metric));
  const mean = timing.filter(metric => !/p50|p95/i.test(metric.id));
  const tail = timing.find(metric => /p95/i.test(metric.id));
  const cost = benchmark.metrics.find(metric => metric.unit === "usd" && metric.id !== "pricePerThousand" && metric.highlightBest !== false && hasValues(metric));
  const resources: Axis[] = [
    ...mean.map(metricAxis),
    ...(tail ? [metricAxis(tail)] : []),
    ...benchmark.metrics.filter(metric => metric.unit === "mib" && hasValues(metric)).map(metricAxis),
  ];

  if (cost) resources.push(metricAxis(cost));


  return [
    ...quality.map(metric => {
      const axis = metricAxis(metric);
      return { ...axis, value: (provider: Provider) => {
        const score = provider.scores[metric.id];
        return typeof score === "number" ? point(score / qualityScale(metric)) : null;
      } };
    }),
    ...resources.flatMap(axis => resourceAxis(axis, benchmark.providers) ?? []),
  ];
}
