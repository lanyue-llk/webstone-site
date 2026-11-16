"use client";

import { useState } from "react";
import { formatMetric, sortProviders, type Benchmark, type Metric, type Provider } from "../lib/results";

type Props = { benchmark: Benchmark; t: (text: string) => string };

function Comparison({ providers, metric, t }: { providers: Provider[]; metric: Metric; t: Props["t"] }) {
  const rows = sortProviders(providers, metric.id, metric.direction).filter(provider => provider.scores[metric.id] != null);
  const values = rows.flatMap(provider => [provider.scores[metric.id]!, provider.confidenceIntervals?.[metric.id]?.lower ?? 0, provider.confidenceIntervals?.[metric.id]?.upper ?? 0]);
  const min = Math.min(0, ...values);
  const scale = metric.unit === "ratio" ? 1 : metric.unit === "percent" || metric.unit === "score" ? (metric.id === "usefulness" ? 3 : 100) : 0;
  const max = Math.max(scale, ...values);
  const position = (value: number) => (value - min) / (max - min || 1) * 100;
  return <ul className="comparison-list">{rows.map(provider => {
    const value = provider.scores[metric.id]!;
    const interval = provider.confidenceIntervals?.[metric.id];
    return <li key={provider.id}>
      <span className="chart-name" title={provider.name}>{provider.name}</span>
      <span className="bar-rail" aria-hidden="true">
        <span className="bar-fill" style={{ left: `${position(Math.min(0, value))}%`, width: `${Math.abs(position(value) - position(0))}%` }} />
        {interval && <span className="confidence-range" style={{ left: `${position(interval.lower)}%`, width: `${position(interval.upper) - position(interval.lower)}%` }} />}
      </span>
      <span className="chart-value">{formatMetric(value, metric.unit, metric.decimals, metric.signed)}
        {interval && <small>{t("95% confidence interval")}: {formatMetric(interval.lower, metric.unit, metric.decimals)}–{formatMetric(interval.upper, metric.unit, metric.decimals)}</small>}
      </span>
    </li>;
  })}</ul>;
}

export default function Insights({ benchmark, t }: Props) {
  const [providerId, setProviderId] = useState(benchmark.providers[0]?.id);
  const provider = benchmark.providers.find(item => item.id === providerId) ?? benchmark.providers[0];
  const primary = benchmark.metrics.find(item => item.id === benchmark.primaryMetric)!;
  const hasIntervals = benchmark.providers.some(item => item.confidenceIntervals?.[primary.id]);
  const p50 = benchmark.metrics.find(item => /p50/i.test(item.id));
  const p95 = benchmark.metrics.find(item => /p95/i.test(item.id) && item.unit === p50?.unit);
  const secondMetric = benchmark.metrics.find(item => item.id === "pss");
  const dimensions = benchmark.id === "webmainbench" ? benchmark.metrics.filter(item => item.id !== primary.id) : [];
  const sourceKeys = ["original", "equivalent", "replica", "missing"] as const;
  const sourceLabels = ["Original URL", "Equivalent URL", "Verified copy", "Not found"];
  const timingMaximum = Math.max(1, ...benchmark.providers.flatMap(item => [p50 ? item.scores[p50.id] ?? 0 : 0, p95 ? item.scores[p95.id] ?? 0 : 0]));
  return <section id="insights" className="insights-section">
    <div className="section-heading"><div><span className="eyebrow">02 / {t("Selected insights")}</span><h2>{t("Selected insights")}</h2></div><p>{t("Selected charts use only the current benchmark and result version.")}</p></div>
    <div className="insight-grid">
      <article className="insight-card">
        <div className="card-heading"><h3>{t("Quality comparison")}</h3><span>{t(primary.label)} · {t(primary.direction === "desc" ? "Higher is better" : "Lower is better")}</span></div>
        <Comparison providers={benchmark.providers} metric={primary} t={t} />
        <p className="chart-note">{t(hasIntervals ? "Intervals are transcribed from the report; point estimates do not establish statistical significance." : "Only disclosed values are shown. No scores are inferred from ranking or chart geometry.")}</p>
      </article>
      <article className="insight-card">
        {benchmark.categories.length > 0 && <>
          <div className="card-heading"><h3>{t("Category performance")}</h3><span>{t("Passed cases / category total")}</span></div>
          <label className="chart-select">{t("Choose a method")}<select value={provider.id} onChange={event => setProviderId(event.target.value)}>{benchmark.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <ul className="comparison-list categories-chart">{benchmark.categories.map(category => <li key={category.id}><span className="chart-name">{t(category.name)}</span><span className="bar-rail" aria-hidden="true"><span className="bar-fill" style={{ width: `${category.total ? (provider.categoryPassed?.[category.id] ?? 0) / category.total * 100 : 0}%` }} /></span><span className="chart-value">{provider.categoryPassed?.[category.id] ?? "—"} / {category.total}</span></li>)}</ul>
        </>}
        {benchmark.sourceMatches && <>
          <div className="card-heading"><h3>{t("Annotated source coverage")}</h3><span>{benchmark.taskCount} {t("cases")}</span></div>
          <div className="chart-legend">{sourceKeys.map((key, index) => <span key={key}><i className={`source-${key}`} />{t(sourceLabels[index])}</span>)}</div>
          <ul className="source-list">{benchmark.providers.map(item => <li key={item.id}><span className="chart-name">{item.name}</span><span className="stacked-bar">{sourceKeys.map((key, index) => <span key={key} className={`source-${key}`} style={{ width: `${benchmark.sourceMatches![item.id][key] / benchmark.taskCount * 100}%` }} title={`${t(sourceLabels[index])}: ${benchmark.sourceMatches![item.id][key]}`}><span className="sr-only">{t(sourceLabels[index])}: {benchmark.sourceMatches![item.id][key]}. </span></span>)}</span></li>)}</ul>
          <p className="chart-note">{t("Each bar uses the quality-scoring population, not the timing-call population.")}</p>
        </>}
        {!benchmark.categories.length && !benchmark.sourceMatches && p50 && p95 && <>
          <div className="card-heading"><h3>{t("Latency distribution")}</h3><span>{t(p50.label)} / {t(p95.label)}</span></div>
          <ul className="timing-list">{benchmark.providers.filter(item => item.scores[p50.id] != null || item.scores[p95.id] != null).map(item => <li key={item.id}><span className="chart-name">{item.name}</span><span className="timing-pair">{[p50, p95].map((m, index) => <span key={m.id} className={`timing-line timing-${index}`}><i aria-hidden="true" style={{ width: `${(item.scores[m.id] ?? 0) / timingMaximum * 100}%` }} /><span>{t(m.label)}: {formatMetric(item.scores[m.id], m.unit, m.decimals)}</span></span>)}</span></li>)}</ul>
          <p className="chart-note">{t("P50 and P95 are published percentiles, not a reconstructed distribution.")}</p>
          {benchmark.trackId === "websearch" && <p className="scope-warning">{t("Different collection dates and concurrency: these timings are not a controlled same-window speed comparison.")}</p>}
        </>}
        {dimensions.length > 0 && <>
          <div className="card-heading"><h3>{t("Category performance")}</h3><span>{provider.name}</span></div>
          <label className="chart-select">{t("Choose a method")}<select value={provider.id} onChange={event => setProviderId(event.target.value)}>{benchmark.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <ul className="comparison-list categories-chart">{dimensions.map(m => <li key={m.id}><span>{t(m.label)}</span><span className="bar-rail" aria-hidden="true"><span className="bar-fill" style={{ width: `${provider.scores[m.id] ?? 0}%` }} /></span><span className="chart-value">{formatMetric(provider.scores[m.id], m.unit, m.decimals)}</span></li>)}</ul>
        </>}
        {secondMetric && <><div className="card-heading"><h3>{t(secondMetric.label)}</h3><span>{t(secondMetric.direction === "asc" ? "Lower is better" : "Higher is better")}</span></div><Comparison providers={benchmark.providers} metric={secondMetric} t={t} /></>}
        {!benchmark.categories.length && !benchmark.sourceMatches && !p50 && !secondMetric && !dimensions.length && <><div className="card-heading"><h3>{t("Methodology & scope")}</h3></div><p className="chart-note">{t("The report does not disclose a comparable second timing metric.")}</p></>}
      </article>
    </div>
  </section>;
}
