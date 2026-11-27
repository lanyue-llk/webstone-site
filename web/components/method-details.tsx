"use client";

import { useEffect, useRef } from "react";
import { methodIdentity, methodResults } from "../lib/methods";
import { benchmarkHref } from "../lib/overview";
import { X } from "lucide-react";
import { formatMetric, formatPricing, type Benchmark, type Provider, type Catalog, type Snapshot } from "../lib/results";

export default function MethodDetails({ provider, benchmark, catalog, snapshots = [], showScores = true, t, onClose }: { provider: Provider | null; benchmark: Benchmark; catalog?: Catalog; snapshots?: Snapshot[]; showScores?: boolean; t: (text: string) => string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  function isBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
    const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget &&
      (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom);
  }

  useEffect(() => {
    if (provider && !dialog.current?.open) dialog.current?.showModal();
    else if (!provider && dialog.current?.open) dialog.current.close();
  }, [provider]);
  const identity=provider&&catalog?methodIdentity(catalog,provider.id):null;
  const history=provider&&catalog?methodResults(catalog,snapshots,provider.id):[];
  const scoredMetrics = benchmark.metrics.filter(metric => {
    const score = provider?.scores[metric.id];
    return score !== null && score !== undefined;
  });
  return <dialog ref={dialog} className="method-dialog" aria-labelledby="method-dialog-title" onClose={onClose}
    onPointerDown={event => { pressedBackdrop.current = isBackdrop(event); }}
    onClick={event => { if (pressedBackdrop.current && isBackdrop(event)) event.currentTarget.close(); }}>
    {provider && <>
      <div className="dialog-heading"><h2 id="method-dialog-title">{provider.name}</h2><button autoFocus className="icon-button" aria-label={t("Close details")} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {provider.description !== provider.name && <p className="method-description">{t(provider.description)}</p>}
      {identity&&<dl className="method-identity"><div><dt>{t("Method ID")}</dt><dd><code>{identity.id}</code></dd></div><div><dt>{t("Product ID")}</dt><dd><code>{identity.productId}</code></dd></div></dl>}
      {history.length>0&&<section className="method-history"><h3>{t("Published results")}</h3><ul>{history.map(({benchmark,provider,version,reportUrl})=><li key={`${benchmark.id}:${provider.id}`}><a href={`${benchmarkHref(benchmark.id)}&version=${version}`}>{benchmark.name} · {version}</a><span>{provider.name}</span><a href={reportUrl} target="_blank" rel="noreferrer">{t("Evaluation report")}</a></li>)}</ul></section>}
      <dl className="method-meta">{provider.mode && provider.mode !== "Not specified" && <div><dt>{t("Configuration")}</dt><dd>{t(provider.mode)}</dd></div>}{(provider.pricing || provider.billingDescription) && <div><dt>{t("Billing basis")}</dt><dd>{provider.billingDescription ? t(provider.billingDescription) : provider.pricing ? <>{t(formatPricing(provider.pricing))} · {t(provider.pricing.description)}</> : t("Not supplied")}</dd></div>}</dl>
      {showScores&&<dl className="method-metrics">{scoredMetrics.map(metric => {
        const counts = provider.counts?.[metric.id];
        const interval = provider.confidenceIntervals?.[metric.id];
        const converted = metric.unit === "ms" || metric.unit === "ratio";
        return <div key={metric.id}><dt>{t(metric.label)}</dt><dd>
          {formatMetric(provider.scores[metric.id], metric.unit, metric.decimals, metric.signed, counts)}
          {converted && <small>{t("Source value")}: {formatMetric(provider.scores[metric.id], metric.unit, metric.decimals, metric.signed, undefined, "source")}{metric.unit === "ratio" && " (0–1)"}
            {interval && <> · {t("95% confidence interval")}: {formatMetric(interval.lower, metric.unit, metric.decimals, false, undefined, "source")}–{formatMetric(interval.upper, metric.unit, metric.decimals, false, undefined, "source")}</>}
          </small>}
          {metric.unit !== "count" && counts && <small>{t("Count / total")}: {counts.count} / {counts.total}</small>}
          {interval && <small>{t("95% confidence interval")}: {formatMetric(interval.lower, metric.unit, metric.decimals)}–{formatMetric(interval.upper, metric.unit, metric.decimals)}</small>}
        </dd></div>;
      })}</dl>}
    </>}
  </dialog>;
}
