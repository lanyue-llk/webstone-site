"use client";

import { useState } from "react";
import { categoryRate, costBounds, qualityMetrics, qualityScale, quotedCost, searchBillingUnit, searchBillingUnits } from "../lib/comparisons";
import { formatMetric, formatPricing, sortProviders, type Benchmark, type Metric, type Provider } from "../lib/results";

type Range = [number, number];
type Measure = {
  id: string;
  label: string;
  bounds: (provider: Provider) => Range | null;
  value: (provider: Provider, bounds: Range) => string;
  fallback?: (provider: Provider) => string;
  tick: (value: number) => string;
  domain?: Range;
  observedScale?: boolean;
};
type Panel = { id: string; title: string; measures: Measure[]; preferred?: string };
type Props = { benchmark: Benchmark; t: (text: string) => string };

function point(value: number | null | undefined): Range | null {
  return typeof value === "number" ? [value, value] : null;
}

function metricMeasure(metric: Metric): Measure {
  const value = (n: number) => formatMetric(n, metric.unit, metric.decimals, metric.signed);
  return {
    id: metric.id, label: metric.label, bounds: provider => point(provider.scores[metric.id]),
    tick: value, value: (_, [n]) => value(n),
    observedScale: ["seconds", "ms", "mib"].includes(metric.unit),
    domain: metric.chartRange ?? (["ratio", "percent", "score"].includes(metric.unit) && !metric.signed ? [0, qualityScale(metric)] : undefined),
  };
}

function comparisonPanels(benchmark: Benchmark): Panel[] {
  const primary = benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric);
  if (!primary) return [];
  const metrics = benchmark.metrics.filter(metric => benchmark.providers.some(provider => typeof provider.scores[metric.id] === "number"));
  const latency = metrics.filter(metric => ["seconds", "ms"].includes(metric.unit));
  const memory = metrics.filter(metric => metric.unit === "mib");
  const otherQuality = qualityMetrics(benchmark).filter(metric => metric.id !== primary.id && metrics.includes(metric));
  const breakdown: Measure[] = otherQuality.map(metricMeasure);
  for (const category of benchmark.categories) {
    const bounds = (provider: Provider) => point(categoryRate(provider, category.id, category.total));
    if (benchmark.providers.some(provider => bounds(provider) !== null)) {
      breakdown.push({
        id: category.id, label: category.name, bounds, domain: [0, 1],
        value: (provider, [n]) => `${provider.categoryPassed?.[category.id]} / ${category.total} (${formatMetric(n * 100, "percent")})`,
        tick: n => formatMetric(n * 100, "percent", 0),
      });
    }
  }

  const price = metrics.find(metric => metric.unit === "usd");
  const priceTick = (n: number) => `$${Number(n.toPrecision(4))}`;
  const quotes: Measure[] = [];
  if (price?.highlightBest === false) {
    for (const unit of searchBillingUnits) {
      const bounds = (provider: Provider) => searchBillingUnit(provider) === unit ? costBounds(provider, price) : null;
      if (benchmark.providers.some(provider => bounds(provider) !== null)) {
        quotes.push({
          id: unit, label: unit === "requests" ? "Per 1,000 requests" : "Per 1,000 successful searches",
          bounds, tick: priceTick, value: (_, [n]) => formatMetric(n, price.unit, price.decimals),
        });
      }
    }
  } else if (price) quotes.push({ ...metricMeasure(price), tick: priceTick });
  if (benchmark.providers.some(provider => quotedCost(provider) !== null)) {
    quotes.push({
      id: "provider-price", label: "Price per 1,000 calls", bounds: quotedCost,
      value: provider => formatPricing(provider.pricing!), tick: priceTick,
      fallback: provider => provider.pricing ? formatPricing(provider.pricing) : "—",
    });
  }

  const panels: Panel[] = [
    { id: "quality", title: "Quality", measures: [metricMeasure(primary)] },
    { id: "latency", title: "Latency", measures: latency.map(metricMeasure), preferred: latency.find(metric => /p50/i.test(metric.id))?.id },
    { id: "memory", title: "Memory", measures: memory.map(metricMeasure) },
    { id: "price", title: "Pricing", measures: quotes },
    { id: "breakdown", title: "Quality breakdown", measures: breakdown },
  ];
  const matches = benchmark.sourceMatches;
  if (matches) {
    panels.push({
      id: "coverage", title: "Source coverage", measures: [{
        id: "original", label: "Original source coverage", domain: [0, 100],
        bounds: provider => {
          const match = matches[provider.id];
          return match ? point(match.original / benchmark.taskCount * 100) : null;
        },
        value: (_, [n]) => formatMetric(n, "percent"), tick: n => formatMetric(n, "percent", 0),
      }],
    });
  }
  return panels.filter(panel => panel.measures.length > 0);
}

function domain(measure: Measure, providers: Provider[]): Range {
  const values = providers.flatMap(provider => measure.bounds(provider) ?? []);
  if (measure.observedScale && values.length > 0) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (low < high) {
      const step = 10 ** Math.floor(Math.log10((high - low) / 4));
      return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
    }
  }
  const min = Math.min(measure.domain?.[0] ?? 0, ...values);
  const max = Math.max(measure.domain?.[1] ?? 0, ...values);
  return [min, max === min ? min + 1 : max];
}

function PlotCell({ provider, measure, limits, t }: { provider: Provider; measure: Measure; limits: Range; t: Props["t"] }) {
  const bounds = measure.bounds(provider);
  if (!bounds) return <span className="plot-unavailable">{t(measure.fallback?.(provider) ?? "—")}</span>;

  const [min, max] = limits;
  const position = (value: number) => `${(value - min) / (max - min) * 100}%`;
  const [low, high] = bounds;
  const style = { "--low": position(low), "--high": position(high) } as React.CSSProperties;
  return <div className="plot-cell">
    <span className="plot-value">{measure.value(provider, bounds)}</span>
    <span className="plot-axis" aria-hidden="true">
      <span className={low === high ? "plot-dot" : "plot-range"} style={style} />
    </span>
  </div>;
}

export default function Insights({ benchmark, t }: Props) {
  const panels = comparisonPanels(benchmark);
  const primary = benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric);
  const [hidden, setHidden] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  if (!primary || benchmark.providers.length === 0) return null;
  const ordered = sortProviders(benchmark.providers, primary.id, primary.direction);
  const shown = ordered.filter(provider => !hidden.includes(provider.id));
  const methodName = (provider: Provider) => provider.name.split(" · ").map(t).join(" · ");
  const columns = panels.map(panel => {
    const measure = panel.measures.find(item => item.id === (choices[panel.id] ?? panel.preferred)) ?? panel.measures[0];
    return { panel, measure, limits: domain(measure, ordered) };
  });

  return <section id="insights" className="insights-section" aria-labelledby="comparison-heading">
    <h2 id="comparison-heading">{t("Compare methods")}</h2>
    <details className="comparison-filter">
      <summary>{t("Filter methods")} <span>{shown.length} / {ordered.length}</span></summary>
      <div className="comparison-methods" role="group" aria-label={t("Methods to compare")}>
        {ordered.map(provider => <label key={provider.id}>
          <input type="checkbox" checked={!hidden.includes(provider.id)} onChange={event => {
            const checked = event.currentTarget.checked;
            setHidden(current => checked ? current.filter(id => id !== provider.id) : [...current, provider.id]);
          }} />
          <span>{methodName(provider)}</span>
        </label>)}
      </div>
    </details>
    {shown.length === 0 ? <p role="status" className="comparison-empty">{t("Select a method to show its results.")}</p> :
      <div className="comparison-scroll" role="region" aria-label={t("Compare methods")} tabIndex={0}>
        <table className="comparison-table">
          <caption className="sr-only">{t("Compare methods")}</caption>
          <thead><tr><th scope="col">{t("Method")}</th>
            {columns.map(({ panel, measure, limits }) => <th scope="col" key={panel.id} data-panel={panel.id}>
              <div className="plot-heading">{t(panel.title)}</div>
              {panel.measures.length > 1 ?
                <select aria-label={t(panel.title)} value={measure.id} onChange={event => {
                  const id = event.currentTarget.value;
                  setChoices(current => ({ ...current, [panel.id]: id }));
                }}>
                  {panel.measures.map(option => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
                </select> : <span className="plot-metric">{t(measure.label)}</span>}
              <span className="plot-scale" aria-hidden="true"><span>{measure.tick(limits[0])}</span><span>{measure.tick(limits[1])}</span></span>
            </th>)}
          </tr></thead>
          <tbody>{shown.map(provider => <tr key={provider.id}>
            <th scope="row">{methodName(provider)}</th>
            {columns.map(({ panel, measure, limits }) => <td key={panel.id} data-panel={panel.id}>
              <PlotCell provider={provider} measure={measure} limits={limits} t={t} />
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
