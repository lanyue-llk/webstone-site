"use client";

import { useState } from "react";
import { categoryRate, qualityMetrics, qualityScale } from "../lib/comparisons";
import { formatMetric, sortProviders, type Benchmark, type Provider } from "../lib/results";

type Props = { benchmark: Benchmark; t: (text: string) => string };
type Axis = { id: string; label: string; value: (provider: Provider) => number | null; display: (provider: Provider) => string };
const colors = ["#28745b", "#5869b0", "#bc7540"];

function radarAxes(benchmark: Benchmark): Axis[] {
  if (benchmark.categories.length >= 3) return benchmark.categories.map(category => ({
    id: category.id, label: category.name,
    value: provider => categoryRate(provider, category.id, category.total),
    display: provider => `${provider.categoryPassed?.[category.id] ?? "—"} / ${category.total}`,
  }));
  return qualityMetrics(benchmark).map(metric => ({
    id: metric.id, label: metric.label,
    value: provider => provider.scores[metric.id] == null ? null : provider.scores[metric.id]! / qualityScale(metric),
    display: provider => formatMetric(provider.scores[metric.id], metric.unit, metric.decimals),
  }));
}

function Radar({ axes, providers, t }: { axes: Axis[]; providers: Provider[]; t: Props["t"] }) {
  const point = (index: number, radius: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  };
  const polygon = (radius: number) => axes.map((_, index) => point(index, radius).join(",")).join(" ");
  return <figure className="comparison-figure">
    <svg viewBox="-250 -180 500 360" role="img" aria-label={t("Capability profile")}>
      {[.25, .5, .75, 1].map(level => <g key={level}><polygon points={polygon(112 * level)} className="radar-grid" /><text x="5" y={-112 * level - 4} className="axis-tick">{level * 100}</text></g>)}
      {axes.map((axis, index) => {
        const [x, y] = point(index, 112), [labelX, labelY] = point(index, 145);
        const words = axis.label.split(" ");
        const split = Math.ceil(words.length / 2);
        const lines = axis.label.length > 17 ? [words.slice(0, split).join(" "), words.slice(split).join(" ")] : [axis.label];
        return <g key={axis.id}><line x1="0" y1="0" x2={x} y2={y} className="radar-axis" /><text x={labelX} y={labelY} textAnchor={labelX > 10 ? "start" : labelX < -10 ? "end" : "middle"} className="axis-label">{lines.map((line, i) => <tspan key={i} x={labelX} dy={i ? 13 : 0}>{line}</tspan>)}</text></g>;
      })}
      {providers.map((provider, index) => <g key={provider.id} style={{ color: colors[index] }}>
        <polygon points={axes.map((axis, i) => point(i, axis.value(provider)! * 112).join(",")).join(" ")} className="radar-shape"><title>{provider.name}</title></polygon>
        {axes.map((axis, i) => { const [x, y] = point(i, axis.value(provider)! * 112); return <circle key={axis.id} cx={x} cy={y} r="3" fill="currentColor"><title>{`${provider.name} · ${axis.label}: ${axis.display(provider)}`}</title></circle>; })}
      </g>)}
    </svg>
    <table className="sr-only"><caption>{t("Capability profile")}</caption><thead><tr><th>{t("Method")}</th>{axes.map(axis => <th key={axis.id}>{axis.label}</th>)}</tr></thead><tbody>{providers.map(provider => <tr key={provider.id}><th>{provider.name}</th>{axes.map(axis => <td key={axis.id}>{axis.display(provider)}</td>)}</tr>)}</tbody></table>
  </figure>;
}

function Scatter({ benchmark, selected, t }: Props & { selected: Provider[] }) {
  const primary = benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric)!;
  const candidates = benchmark.metrics.filter(metric => ["seconds", "ms", "mib"].includes(metric.unit) && metric.highlightBest !== false);
  const preferred = candidates.find(metric => /p50/i.test(metric.id)) ?? candidates.find(metric => metric.unit === "mib") ?? candidates[0];
  const [xId, setXId] = useState(preferred?.id);
  const xMetric = candidates.find(metric => metric.id === xId) ?? preferred;
  const coverage = Boolean(benchmark.sourceMatches);
  if (!coverage && !xMetric) return null;
  const rows = benchmark.providers.flatMap(provider => {
    const x = coverage ? benchmark.sourceMatches![provider.id].original / benchmark.taskCount * 100 : provider.scores[xMetric!.id];
    const y = provider.scores[primary.id];
    return x == null || y == null ? [] : [{ provider, x, y }];
  });
  if (rows.length < 2) return null;
  const minimum = Math.min(...rows.map(row => row.x)), maximum = Math.max(...rows.map(row => row.x));
  const log = !coverage && minimum > 0 && maximum / minimum > 10;
  const low = log ? Math.floor(Math.log10(minimum)) : 0;
  const high = coverage ? 100 : log ? Math.ceil(Math.log10(maximum)) : Math.max(1, maximum * 1.08);
  const xPosition = (value: number) => 60 + ((log ? Math.log10(value) : value) - low) / (high - low || 1) * 360;
  const yMaximum = qualityScale(primary);
  const xLabel = coverage ? t("Original source coverage") : xMetric!.label;
  const formatX = (value: number) => coverage ? `${value.toFixed(1)}%` : formatMetric(value, xMetric!.unit, xMetric!.decimals);
  return <article className="insight-card scatter-card">
    <div className="card-heading"><h3>{t(coverage ? "Source coverage and quality" : "Quality and resources")}</h3>{!coverage && candidates.length > 1 && <select aria-label={t("Horizontal axis")} value={xMetric!.id} onChange={event => setXId(event.target.value)}>{candidates.map(metric => <option key={metric.id} value={metric.id}>{metric.label}</option>)}</select>}</div>
    <figure className="comparison-figure"><svg viewBox="0 0 480 330" role="img" aria-label={`${primary.label} / ${xLabel}`}>
      {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1="60" x2="420" y1={260 - fraction * 220} y2={260 - fraction * 220} className="radar-grid" /><text x="48" y={264 - fraction * 220} textAnchor="end" className="axis-tick">{formatMetric(yMaximum * fraction, primary.unit, primary.decimals)}</text></g>)}
      {[0, .5, 1].map(fraction => { const value = log ? 10 ** (low + fraction * (high - low)) : high * fraction; return <text key={fraction} x={60 + fraction * 360} y="282" textAnchor="middle" className="axis-tick">{formatX(value)}</text>; })}
      <text x="60" y="20" className="axis-label">{primary.label}</text><text x="240" y="313" textAnchor="middle" className="axis-label">{xLabel}{log ? ` · ${t("log scale")}` : ""}</text>
      {rows.map(({ provider, x, y }) => {
        const index = selected.findIndex(item => item.id === provider.id);
        const interval = provider.confidenceIntervals?.[primary.id];
        const label = `${provider.name} · ${xLabel}: ${formatX(x)} · ${primary.label}: ${formatMetric(y, primary.unit, primary.decimals)}`;
        return <g key={provider.id}>{interval && <line x1={xPosition(x)} x2={xPosition(x)} y1={260 - interval.lower / yMaximum * 220} y2={260 - interval.upper / yMaximum * 220} stroke={index < 0 ? "#c7cec9" : colors[index]} strokeWidth="2"><title>{`${interval.level * 100}% CI: ${interval.lower}–${interval.upper}`}</title></line>}<circle cx={xPosition(x)} cy={260 - y / yMaximum * 220} r={index < 0 ? 5 : 9} fill={index < 0 ? "#c7cec9" : colors[index]} stroke="white" strokeWidth="1.5" tabIndex={0} aria-label={label}><title>{label}</title></circle>{index >= 0 && <text x={xPosition(x)} y={264 - y / yMaximum * 220} textAnchor="middle" className="point-number" aria-hidden="true">{index + 1}</text>}</g>;
      })}
    </svg><figcaption>{t(coverage ? "The horizontal axis is the share of evaluated cases with an original source URL. It does not imply causation." : "Observed measurements; methods may use different execution and billing conditions.")}</figcaption></figure>
  </article>;
}

export default function Insights({ benchmark, t }: Props) {
  const axes = radarAxes(benchmark);
  const hasRadar = axes.length >= 3;
  const eligible = benchmark.providers.filter(provider => !hasRadar || axes.every(axis => axis.value(provider) != null));
  const [ids, setIds] = useState(() => sortProviders(eligible, benchmark.primaryMetric, benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric)!.direction).slice(0, 3).map(provider => provider.id));
  const selected = ids.flatMap(id => eligible.find(provider => provider.id === id) ?? []);
  const hasScatter = Boolean(benchmark.sourceMatches) || benchmark.metrics.some(metric => ["seconds", "ms", "mib"].includes(metric.unit) && metric.highlightBest !== false);
  if (!hasRadar && !hasScatter) return null;
  return <section id="insights" className="insights-section">
    <div className="section-heading"><h2>{t("Compare methods")}</h2><span className="comparison-limit">{t("Select up to three methods")}</span></div>
    <div className="comparison-methods" role="group" aria-label={t("Methods to compare")}>{benchmark.providers.map(provider => {
      const index = ids.indexOf(provider.id), available = eligible.includes(provider);
      return <label key={provider.id} style={{ "--series-color": index < 0 ? "#bdc7bf" : colors[index] } as React.CSSProperties}><input type="checkbox" checked={index >= 0} disabled={!available || (index < 0 && ids.length >= 3)} onChange={() => setIds(current => current.includes(provider.id) ? current.filter(id => id !== provider.id) : [...current, provider.id])} />{index >= 0 && <b className="series-number" aria-hidden="true">{index + 1}</b>}<span>{provider.name}</span>{!available && <small>{t("Incomplete metrics")}</small>}</label>;
    })}</div>
    <div className={`insight-grid ${hasRadar && hasScatter ? "" : "single-chart"}`}>
      {hasRadar && <article className="insight-card"><div className="card-heading"><h3>{t("Capability profile")}</h3></div><Radar axes={axes} providers={selected} t={t} /><p className="chart-note">{t(benchmark.categories.length >= 3 ? "Category pass rates use each category's own sample count." : "Axes show 0–100% of each metric's defined range, without combining them into a score.")}{benchmark.providers.some(provider => provider.confidenceIntervals) && <> {t("Confidence intervals are available in method details.")}</>}</p></article>}
      {hasScatter && <Scatter benchmark={benchmark} selected={selected} t={t} />}
    </div>
  </section>;
}
