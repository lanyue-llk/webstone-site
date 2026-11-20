"use client";

import { useState } from "react";
import { categoryRate, costBounds, hasComparableChartCosts, qualityMetrics, qualityScale, quotedCost, searchBillingUnit, searchBillingUnits } from "../lib/comparisons";
import { formatMetric, formatPricing, sortProviders, type Benchmark, type Provider } from "../lib/results";

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
    value: provider => {
      const score = provider.scores[metric.id];
      if (score === null || score === undefined) return null;
      return score / qualityScale(metric);
    },
    display: provider => formatMetric(provider.scores[metric.id], metric.unit, metric.decimals),
  }));
}

function Radar({ axes, providers, selection, t }: { axes: Axis[]; providers: Provider[]; selection: Provider[]; t: Props["t"] }) {
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
        let anchor: "start" | "end" | "middle" = "middle";
        if (labelX > 10) anchor = "start";
        if (labelX < -10) anchor = "end";
        return <g key={axis.id}><line x1="0" y1="0" x2={x} y2={y} className="radar-axis" /><text x={labelX} y={labelY} textAnchor={anchor} className="axis-label">{lines.map((line, i) => <tspan key={i} x={labelX} dy={i ? 13 : 0}>{line}</tspan>)}</text></g>;
      })}
      {providers.map(provider => <g key={provider.id} style={{ color: colors[selection.findIndex(item => item.id === provider.id)] }}>
        <polygon points={axes.map((axis, i) => point(i, axis.value(provider)! * 112).join(",")).join(" ")} className="radar-shape"><title>{provider.name}</title></polygon>
        {axes.map((axis, i) => { const [x, y] = point(i, axis.value(provider)! * 112); return <circle key={axis.id} cx={x} cy={y} r="3" fill="currentColor"><title>{`${provider.name} · ${axis.label}: ${axis.display(provider)}`}</title></circle>; })}
      </g>)}
    </svg>
    <table className="sr-only"><caption>{t("Capability profile")}</caption><thead><tr><th>{t("Method")}</th>{axes.map(axis => <th key={axis.id}>{axis.label}</th>)}</tr></thead><tbody>{providers.map(provider => <tr key={provider.id}><th>{provider.name}</th>{axes.map(axis => <td key={axis.id}>{axis.display(provider)}</td>)}</tr>)}</tbody></table>
  </figure>;
}

function Scatter({ benchmark, selected, t, cost = false, sourceCoverage = false }: Props & { selected: Provider[]; cost?: boolean; sourceCoverage?: boolean }) {
  const primary = benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric)!;
  const candidates = benchmark.metrics.filter(metric => ["seconds", "ms", "mib"].includes(metric.unit));
  const preferred = candidates.find(metric => /p50/i.test(metric.id)) ?? candidates.find(metric => ["seconds", "ms"].includes(metric.unit)) ?? candidates[0];
  const [xId, setXId] = useState(preferred?.id);
  const priceMetric = benchmark.metrics.find(metric => metric.unit === "usd");
  const numericPrices = priceMetric && benchmark.providers.some(provider => costBounds(provider, priceMetric) !== null) ? priceMetric : undefined;
  const billingOptions = priceMetric?.highlightBest === false
    ? searchBillingUnits.filter(unit => benchmark.providers.some(provider => searchBillingUnit(provider) === unit && costBounds(provider, priceMetric)))
    : [];
  const [billingUnit, setBillingUnit] = useState(billingOptions.at(-1));
  const matchesBilling = (provider: Provider) => !billingUnit || searchBillingUnit(provider) === billingUnit;
  const reportedCost = (provider: Provider) => costBounds(provider, priceMetric) ?? quotedCost(provider);
  const bubbleCost = (provider: Provider) => matchesBilling(provider) ? costBounds(provider, priceMetric) : null;
  function costLabel(provider: Provider) {
    if (priceMetric) {
      const value = provider.scores[priceMetric.id];
      if (value !== null && value !== undefined) return formatMetric(value, priceMetric.unit, priceMetric.decimals);
    }
    if (provider.pricing) return t(formatPricing(provider.pricing));
    return t("Cost unavailable");
  }
  const xMetric = cost ? numericPrices ?? { id: "quoted-price", label: t("Quoted price / 1K"), unit: "usd", direction: "asc" as const } : candidates.find(metric => metric.id === xId) ?? preferred;
  const coverage = !cost && Boolean(benchmark.sourceMatches) && (sourceCoverage || !xMetric);
  if (!coverage && !xMetric) return null;
  const pricedMethods = billingUnit ? benchmark.providers.filter(provider => {
    const x = provider.scores[xMetric?.id ?? ""];
    const y = provider.scores[primary.id];
    return bubbleCost(provider) && x !== null && x !== undefined && y !== null && y !== undefined;
  }) : [];
  const showBubbles = !cost && !coverage && (billingUnit
    ? pricedMethods.length > 0
    : hasComparableChartCosts(benchmark.providers, priceMetric));
  let title = showBubbles ? "Accuracy, latency and cost" : "Accuracy and latency";
  if (xMetric?.unit === "mib") title = showBubbles ? "Quality, resources and cost" : "Quality and resources";
  if (coverage) title = "Source coverage and quality";
  if (cost) title = "Accuracy and cost";
  const billingLabel = billingUnit === "requests" ? t("Per 1,000 requests") : t("Per 1,000 successful searches");
  const heading = <div className="card-heading">
    <h3>{t(title)}</h3>
    <div className="chart-controls">
      {!cost && !coverage && candidates.length > 1 && <select aria-label={t("Horizontal axis")} value={xMetric!.id} onChange={event => setXId(event.target.value)}>{candidates.map(metric => <option key={metric.id} value={metric.id}>{t(metric.label)}</option>)}</select>}
      {!coverage && billingOptions.length > 0 && <select aria-label={t("Billing unit")} value={billingUnit} onChange={event => setBillingUnit(billingOptions.find(unit => unit === event.target.value))}>
        {billingOptions.map(unit => <option key={unit} value={unit}>{t(unit === "requests" ? "Per 1,000 requests" : "Per 1,000 successful searches")}</option>)}
      </select>}
    </div>
  </div>;
  const missingQuality = benchmark.providers.filter(provider => provider.scores[primary.id] === null || provider.scores[primary.id] === undefined);
  const disclosures = <>
    {cost && <p className="chart-note">{t("Cost unavailable")}: {benchmark.providers.filter(provider => !reportedCost(provider)).map(provider => provider.name).join(", ") || t("None")}</p>}
    {cost && missingQuality.length > 0 && <p className="chart-note">{t("Quality unavailable")}: {missingQuality.map(provider => provider.name).join(", ")}</p>}
  </>;
  const rows = benchmark.providers.flatMap(provider => {
    if (cost && !matchesBilling(provider)) return [];
    const range = cost ? reportedCost(provider) : null;
    let x = provider.scores[xMetric?.id ?? ""];
    if (coverage) x = benchmark.sourceMatches![provider.id].original / benchmark.taskCount * 100;
    if (cost) x = range?.[0] ?? null;
    const y = provider.scores[primary.id];
    if (x === null || x === undefined || y === null || y === undefined) return [];
    return [{ provider, x, y, upper: range?.[1] ?? x }];
  });
  if (rows.length < 2) return <article className="insight-card scatter-card">
    {heading}<p className="chart-note" role="status">{t("At least two methods with both axis values are needed to compare.")}</p>
    {disclosures}
  </article>;
  const maximumCost = Math.max(0, ...rows.flatMap(row => bubbleCost(row.provider) ?? []));
  const costRadius = (value: number) => Math.sqrt(16 + value / (maximumCost || 1) * 400);
  const minimum = Math.min(...rows.map(row => row.x)), maximum = Math.max(...rows.map(row => row.upper));
  const log = !coverage && minimum > 0 && maximum / minimum > 10;
  const low = log ? Math.floor(Math.log10(minimum)) : Math.min(0, minimum);
  let high = maximum > 0 ? maximum * 1.08 : 1;
  if (log) high = Math.ceil(Math.log10(maximum));
  if (coverage) high = 100;
  const xPosition = (value: number) => 60 + ((log ? Math.log10(value) : value) - low) / (high - low || 1) * 360;
  const yMaximum = qualityScale(primary);
  let xLabel: string;
  if (coverage) xLabel = t("Original source coverage");
  else if (cost && billingUnit) xLabel = billingLabel;
  else xLabel = t(xMetric!.label);
  function formatX(value: number) {
    if (coverage) return `${value.toFixed(1)}%`;
    if (cost && !numericPrices) return `$${Number(value.toPrecision(3))}`;
    return formatMetric(value, xMetric!.unit, xMetric!.decimals);
  }
  return <article className="insight-card scatter-card">
    {heading}
    <figure className="comparison-figure"><svg viewBox="0 0 480 330" role="img" aria-label={`${primary.label} / ${xLabel}`}>
      {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1="60" x2="420" y1={260 - fraction * 220} y2={260 - fraction * 220} className="radar-grid" /><text x="48" y={264 - fraction * 220} textAnchor="end" className="axis-tick">{formatMetric(yMaximum * fraction, primary.unit, primary.decimals)}</text></g>)}
      {[0, .5, 1].map(fraction => { const value = log ? 10 ** (low + fraction * (high - low)) : low + (high - low) * fraction; return <text key={fraction} x={60 + fraction * 360} y="282" textAnchor="middle" className="axis-tick">{formatX(value)}</text>; })}
      <text x="60" y="20" className="axis-label">{primary.label}</text><text x="240" y="313" textAnchor="middle" className="axis-label">{xLabel}{log ? ` · ${t("log scale")}` : ""}</text>
      {rows.map(({ provider, x, y, upper }) => {
        const index = selected.findIndex(item => item.id === provider.id);
        const interval = provider.confidenceIntervals?.[primary.id];
        const bounds = bubbleCost(provider);
        const bubble = showBubbles;
        const color = index < 0 ? "#9aa79d" : colors[index];
        let radius = index < 0 ? 5 : 9;
        if (bubble) {
          radius = 6;
          if (bounds && (!billingUnit || pricedMethods.length >= 2)) radius = costRadius(bounds[1]);
        }
        const price = costLabel(provider);
        const label = `${provider.name} · ${xLabel}: ${formatX(x)}${upper !== x ? `–${formatX(upper)}` : ""} · ${primary.label}: ${formatMetric(y, primary.unit, primary.decimals)}`;
        return <g key={provider.id}>{upper !== x && <line x1={xPosition(x)} x2={xPosition(upper)} y1={260 - y / yMaximum * 220} y2={260 - y / yMaximum * 220} stroke={index < 0 ? "#89978c" : colors[index]} strokeWidth="4"><title>{label}</title></line>}{interval && <line x1={xPosition(x)} x2={xPosition(x)} y1={260 - interval.lower / yMaximum * 220} y2={260 - interval.upper / yMaximum * 220} stroke={index < 0 ? "#c7cec9" : colors[index]} strokeWidth="2"><title>{`${interval.level * 100}% CI: ${interval.lower}–${interval.upper}`}</title></line>}<circle cx={xPosition(x)} cy={260 - y / yMaximum * 220} r={radius} fill={(bubble && !bounds) || upper !== x ? "white" : color} fillOpacity={bubble ? .65 : 1} stroke={color} strokeWidth="1.5" tabIndex={0} aria-label={`${label} · ${t("Cost")}: ${price}`}><title>{`${label} · ${t("Cost")}: ${price}`}</title></circle>{bubble && bounds && bounds[0] !== bounds[1] && <circle cx={xPosition(x)} cy={260 - y / yMaximum * 220} r={costRadius(bounds[0])} fill="white" fillOpacity=".5" stroke={color} strokeDasharray="2 2" aria-hidden="true" />}{index >= 0 && <text x={xPosition(x)} y={bubble || upper !== x ? 255 - y / yMaximum * 220 - radius : 264 - y / yMaximum * 220} textAnchor="middle" className="point-number" style={{ fill: bubble || upper !== x ? color : "white" }} aria-hidden="true">{index + 1}</text>}</g>;
      })}
    </svg><figcaption>{t(coverage ? "The horizontal axis is the share of evaluated cases with an original source URL. It does not imply causation." : "Observed measurements; methods may use different execution and billing conditions.")}</figcaption></figure>
    {showBubbles && <p className="bubble-legend">{t(billingUnit
      ? "Larger bubbles indicate higher quotes in the selected billing unit. Hollow markers have no quote in that unit."
      : "Bubble size represents reported cost: smaller is cheaper. Inner/outer circles show a quoted range; hollow markers have no disclosed total cost. Check billing units before comparing.")}</p>}
    {!coverage && !cost && priceMetric?.highlightBest === false && !billingUnit && <p className="chart-note">{t("See Accuracy and cost for quotes with different billing units.")}</p>}
    {cost && <p className="chart-note">{t("Lines show quoted price ranges. Check the billing basis in method details before comparing prices.")}</p>}
    {disclosures}
    <table className="sr-only"><caption>{`${primary.label} / ${xLabel}`}</caption><thead><tr><th>{t("Method")}</th><th>{xLabel}</th><th>{primary.label}</th><th>{t("Confidence interval")}</th>{!cost && <th>{t("Cost")}</th>}</tr></thead><tbody>{rows.map(({ provider, x, y, upper }) => {
      const interval = provider.confidenceIntervals?.[primary.id];
      return <tr key={provider.id}><th scope="row">{provider.name}</th><td>{formatX(x)}{upper !== x ? `–${formatX(upper)}` : ""}</td><td>{formatMetric(y, primary.unit, primary.decimals)}</td><td>{interval ? `${interval.level * 100}%: ${formatMetric(interval.lower, primary.unit, primary.decimals)}–${formatMetric(interval.upper, primary.unit, primary.decimals)}` : "—"}</td>{!cost && <td>{costLabel(provider)}</td>}</tr>;
    })}</tbody></table>
  </article>;
}

export default function Insights({ benchmark, t }: Props) {
  const axes = radarAxes(benchmark).map(axis => ({ ...axis, label: t(axis.label) }));
  const hasRadar = axes.length >= 3;
  const [ids, setIds] = useState(() => sortProviders(benchmark.providers, benchmark.primaryMetric, benchmark.metrics.find(metric => metric.id === benchmark.primaryMetric)!.direction).slice(0, 3).map(provider => provider.id));
  const selected = ids.flatMap(id => benchmark.providers.find(provider => provider.id === id) ?? []);
  const hasScatter = Boolean(benchmark.sourceMatches) || benchmark.metrics.some(metric => ["seconds", "ms", "mib"].includes(metric.unit));
  const priceMetric = benchmark.metrics.find(metric => metric.unit === "usd");
  const hasCost = benchmark.providers.some(provider => costBounds(provider, priceMetric) !== null || quotedCost(provider) !== null);
  if (!hasRadar && !hasScatter && !hasCost) return null;
  return <section id="insights" className="insights-section">
    <div className="section-heading"><h2>{t("Compare methods")}</h2><span className="comparison-limit">{t("Select up to three methods")}</span></div>
    <div className="comparison-methods" role="group" aria-label={t("Methods to compare")}>{benchmark.providers.map(provider => {
      const index = ids.indexOf(provider.id);
      return <label key={provider.id} style={{ "--series-color": index < 0 ? "#bdc7bf" : colors[index] } as React.CSSProperties}><input type="checkbox" checked={index >= 0} disabled={index < 0 && ids.length >= 3} onChange={() => setIds(current => current.includes(provider.id) ? current.filter(id => id !== provider.id) : [...current, provider.id])} />{index >= 0 && <b className="series-number" aria-hidden="true">{index + 1}</b>}<span>{provider.name}</span></label>;
    })}</div>
    <div className={`insight-grid ${hasScatter && hasRadar ? "" : "single-chart"}`}>
          {hasRadar && <article className="insight-card"><div className="card-heading"><h3>{t("Capability profile")}</h3></div><Radar axes={axes} providers={selected.filter(provider => axes.every(axis => axis.value(provider) !== null))} selection={selected} t={t} />{selected.some(provider => axes.some(axis => axis.value(provider) === null)) && <p className="chart-note">{t("Profile data unavailable")}: {selected.filter(provider => axes.some(axis => axis.value(provider) === null)).map(provider => provider.name).join(", ")}</p>}<p className="chart-note">{t(benchmark.categories.length >= 3 ? "Category pass rates use each category's own sample count." : "Axes show 0–100% of each metric's defined range, without combining them into a score.")}{benchmark.providers.some(provider => provider.confidenceIntervals) && <> {t("Confidence intervals are available in method details.")}</>}</p></article>}
      {hasScatter && <Scatter benchmark={benchmark} selected={selected} t={t} />}

    </div>
    {hasCost && (hasScatter
      ? <details className="profile-details"><summary>{t("Accuracy and cost")}</summary><Scatter benchmark={benchmark} selected={selected} t={t} cost /></details>
      : <Scatter benchmark={benchmark} selected={selected} t={t} cost />)}
      {benchmark.sourceMatches && benchmark.metrics.some(metric => ["seconds", "ms", "mib"].includes(metric.unit)) && <details className="coverage-details"><summary>{t("Source coverage and quality")}</summary><Scatter benchmark={benchmark} selected={selected} t={t} sourceCoverage /></details>}
  </section>;
}
