"use client";

import { useId, useState } from "react";
import { categoryRate, qualityMetrics, qualityScale } from "../lib/comparisons";
import { formatMetric, sortProviders, type Benchmark, type Provider } from "../lib/results";

type Props = { benchmark: Benchmark; t: (text: string) => string };
type Axis = { id: string; label: string; value: (provider: Provider) => number | null; display: (provider: Provider) => string };
const radius = 116;
const colors = ["#007d64", "#5163a8", "#ad5229", "#925c95", "#247a9c", "#926b18",
  "#ac4e67", "#507d35", "#674bc1", "#4d7373", "#aa4944", "#4e5c70"];

function radarAxes(benchmark: Benchmark): Axis[] {
  if (benchmark.categories.length >= 3) return benchmark.categories.map(category => ({
    id: category.id, label: category.name,
    value: provider => categoryRate(provider, category.id, category.total),
    display: provider => `${provider.categoryPassed?.[category.id]} / ${category.total}`,
  }));
  return qualityMetrics(benchmark).map(metric => ({
    id: metric.id, label: metric.label,
    value: provider => {
      const score = provider.scores[metric.id];
      if (score === null || score === undefined) return null;
      return score / qualityScale(metric);
    },
    display: provider => formatMetric(provider.scores[metric.id], metric.unit, metric.decimals),
  }));
}

export default function Insights({ benchmark, t }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const descriptionId = useId();
  const axes = radarAxes(benchmark).map(axis => ({ ...axis, label: t(axis.label) }));
  const primary = benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric);
  if (axes.length < 3 || !primary) return null;

  const providers = sortProviders(benchmark.providers, primary.id, primary.direction).flatMap(provider => {
    const values = axes.map(axis => axis.value(provider));
    if (!values.every(value => value !== null)) return [];
    return [{ provider, values }];
  });
  if (providers.length === 0) return null;

  function point(index: number, distance: number) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
    return [Math.cos(angle) * distance, Math.sin(angle) * distance];
  }
  const ring = (level: number) => axes.map((_, index) => point(index, radius * level).join(",")).join(" ");
  const visible = providers.filter(({ provider }) => !hidden.includes(provider.id));
  const methodName = (provider: Provider) => provider.name.split(" · ").map(t).join(" · ");
  const profileLabel = (provider: Provider) =>
    [methodName(provider), ...axes.map(axis => `${axis.label}: ${axis.display(provider)}`)].join(" · ");

  return <section id="insights" className="insights-section" aria-labelledby="comparison-heading">
    <h2 id="comparison-heading">{t("Capability profile")}</h2>
    <div className="radar-legend" role="group" aria-label={t("Methods to compare")}>
      {providers.map(({ provider }, index) => <label key={provider.id} style={{ color: colors[index % colors.length] }}>
        <input type="checkbox" checked={!hidden.includes(provider.id)} onChange={event => {
          const checked = event.currentTarget.checked;
          setHidden(current => checked ? current.filter(id => id !== provider.id) : [...current, provider.id]);
        }} />
        <span>{methodName(provider)}</span>
      </label>)}
    </div>
    <figure className="radar-figure">
      <svg viewBox="-260 -180 520 360" role="img" aria-label={t("Capability profile")} aria-describedby={descriptionId}>
        <desc id={descriptionId}>{visible.map(({ provider }) => profileLabel(provider)).join(". ")}</desc>
        {[.25, .5, .75, 1].map(level => <g key={level}>
          <polygon points={ring(level)} className="radar-grid" />
          <text x="5" y={-radius * level + 12} className="radar-tick">{level * 100}%</text>
        </g>)}
        {axes.map((axis, index) => {
          const [x, y] = point(index, radius);
          const [labelX, labelY] = point(index, radius + 25);
          const words = axis.label.split(" ");
          const split = Math.ceil(words.length / 2);
          const lines = words.length > 1 && axis.label.length > 17
            ? [words.slice(0, split).join(" "), words.slice(split).join(" ")] : [axis.label];
          let anchor: "middle" | "start" | "end" = "middle";
          if (labelX > 10) anchor = "start";
          if (labelX < -10) anchor = "end";
          return <g key={axis.id}>
            <line x1="0" y1="0" x2={x} y2={y} className="radar-axis" />
            <text x={labelX} y={labelY} textAnchor={anchor} className="radar-label">
              {lines.map((line, i) => <tspan key={line} x={labelX} dy={i === 0 ? 0 : 14}>{line}</tspan>)}
            </text>
          </g>;
        })}
        {providers.map(({ provider, values }, index) => {
          if (hidden.includes(provider.id)) return null;
          const label = profileLabel(provider);
          return <g key={provider.id} className="radar-series" style={{ color: colors[index % colors.length] }}>
            <polygon className="radar-shape" points={values.map((value, i) => point(i, value * radius).join(",")).join(" ")}
              tabIndex={0} aria-label={label}>
              <title>{label}</title>
            </polygon>
          </g>;
        })}
      </svg>
      {benchmark.categories.length < 3 && <figcaption>{t("Each axis is shown as a percentage of the metric’s maximum.")}</figcaption>}
      {visible.length === 0 && <p role="status">{t("Select a method to show its results.")}</p>}
    </figure>
  </section>;
}
