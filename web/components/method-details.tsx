"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { formatMetric, formatPricing, type Benchmark, type Provider } from "../lib/results";

export default function MethodDetails({ provider, benchmark, t, onClose }: { provider: Provider | null; benchmark: Benchmark; t: (text: string) => string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (provider && !dialog.current?.open) dialog.current?.showModal();
    else if (!provider && dialog.current?.open) dialog.current.close();
  }, [provider]);
  return <dialog ref={dialog} className="method-dialog" aria-labelledby="method-dialog-title" onClose={onClose}>
    {provider && <>
      <div className="dialog-heading"><div><span className="eyebrow">{t("Method details")}</span><h2 id="method-dialog-title">{provider.name}</h2></div><button autoFocus className="icon-button" aria-label={t("Close details")} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {provider.description !== provider.name && <p className="chart-note">{t(provider.description)}</p>}
      <dl className="method-meta">{provider.mode && provider.mode !== "Not specified" && <div><dt>{t("Configuration")}</dt><dd>{t(provider.mode)}</dd></div>}{(provider.pricing || provider.billingDescription) && <div><dt>{t("Billing basis")}</dt><dd>{provider.billingDescription ? t(provider.billingDescription) : provider.pricing ? <>{t(formatPricing(provider.pricing))} · {t(provider.pricing.description)}</> : t("Not supplied")}</dd></div>}</dl>
      <dl className="method-metrics">{benchmark.metrics.map(metric => <div key={metric.id}><dt>{t(metric.label)}</dt><dd>{formatMetric(provider.scores[metric.id], metric.unit, metric.decimals, metric.signed, provider.counts?.[metric.id])}{provider.confidenceIntervals?.[metric.id] && <small>{t("95% confidence interval")}: {formatMetric(provider.confidenceIntervals[metric.id].lower, metric.unit, metric.decimals)}–{formatMetric(provider.confidenceIntervals[metric.id].upper, metric.unit, metric.decimals)}</small>}</dd></div>)}</dl>
    </>}
  </dialog>;
}
