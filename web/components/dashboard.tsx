"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUpRight, Bot, FileJson2, Globe2, Layers3, Menu, Search } from "lucide-react";
import { canonicalVersion, benchmarkEntries, bestValue, formatMetric, formatPricing, isBestValue, latestEntry, reportEntries, resolveBenchmark, selectEntry, sortProviders, type Catalog, type Entry, type Metric, type Provider, type ReportFile, type Snapshot } from "../lib/results";
import { providerColors } from "../lib/presentation";
import InfoTooltip from "./info-tooltip";
import Insights from "./insights";
import MethodDetails from "./method-details";
import ReleaseCheck from "./release-check";
import { RELEASE, BUILT_AT } from "../lib/release.generated";
import { translator } from "../lib/i18n";
import { useLanguage } from "../lib/use-language";
import { decisionMetrics } from "../lib/comparisons";

const TRACK_ICONS: Record<string, typeof Globe2> = { webfetch: Globe2, websearch: Search, "trajectory-replay": Bot, webextract: FileJson2 };
const GITHUB_URL = "https://github.com/lexmount/webstone-site";
type Selection = { benchmark: string; version: string; metric: string };

export default function Dashboard() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selection, setSelection] = useState<Selection>({ benchmark: "lexbench-webfetch", version: "", metric: "passRate" });
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [language, chooseLanguage] = useLanguage();
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [moreMetrics, setMoreMetrics] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [catalogResponse, resultsResponse] = await Promise.all([fetch(`/benchmarks/catalog.json?release=${RELEASE}`, { cache: "no-store" }), fetch(`/results/reports.json?release=${RELEASE}`, { cache: "no-store" })]);
        if (!catalogResponse.ok || !resultsResponse.ok) throw new Error("Unable to load result data.");
        const benchmarkCatalog: Catalog = await catalogResponse.json();
        const files: ReportFile[] = await resultsResponse.json();
        const resultEntries = reportEntries(files);
        const records = files.map(item => item.report);
        if (!active) return;
        setCatalog(benchmarkCatalog);
        setEntries(resultEntries);
        setSnapshots(records);
        const params = new URLSearchParams(window.location.search);
        const candidate = params.get("benchmark");
        const benchmark = benchmarkCatalog.benchmarks.some(item => item.id === candidate) ? candidate! : benchmarkCatalog.benchmarks[0].id;
        const requestedVersion = params.get("version");
        const selectedEntry = requestedVersion
          ? selectEntry(resultEntries, requestedVersion, benchmark)
          : latestEntry(resultEntries, benchmark);
        const version = selectedEntry ? canonicalVersion(selectedEntry.version) : requestedVersion ?? "";
        const selectedResult = records.find(record => record.id === selectedEntry?.id)?.benchmarks.find(item => item.id === benchmark);
        const selectedBenchmark = selectedResult ? resolveBenchmark(benchmarkCatalog, selectedResult) : null;
        const selectedMetric = selectedBenchmark?.metrics.find(item => item.id === params.get("metric")) ?? selectedBenchmark?.metrics.find(item => item.id === selectedBenchmark.primaryMetric);
        setSelection({
          benchmark,
          version,
          metric: selectedMetric?.id ?? "passRate",
        });
        setDirection(selectedMetric?.direction ?? "desc");
      } catch {
        if (active) setError("Unable to load results. Please try again.");
      }
    }
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!entries) return;
    const params = new URLSearchParams({ benchmark: selection.benchmark });
    if (selection.version) params.set("version", selection.version);
    params.set("metric", selection.metric);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [selection, entries]);

  const entry = entries ? selectEntry(entries, selection.version, selection.benchmark) : null;
  const snapshot = snapshots.find(item => item.id === entry?.id) ?? null;
  const t = translator(language, catalog, snapshot);
  const result = snapshot?.benchmarks.find(item => item.id === selection.benchmark);
  const benchmark = catalog && result ? resolveBenchmark(catalog, result) : null;
  const details = catalog?.benchmarks.find(item => item.id === selection.benchmark);
  const tracks = catalog?.tracks.map(item => ({ ...item, benchmarks: catalog.benchmarks.filter(bench => bench.trackId === item.id) })) ?? [];
  const track = tracks.find(item => item.id === details?.trackId);
  const metric = benchmark?.metrics.find(item => item.id === selection.metric) ?? benchmark?.metrics.find(item => item.id === benchmark.primaryMetric) ?? benchmark?.metrics[0];
  const versionEntries = entries ? benchmarkEntries(entries, selection.benchmark) : [];
  const versions = versionEntries.map(item => canonicalVersion(item.version));
  const providers = benchmark && metric ? sortProviders(benchmark.providers, metric.id, direction) : [];
  const categories = showCategories ? benchmark?.categories ?? [] : [];
  const primaryMetric = benchmark?.metrics.find(item => item.id === benchmark.primaryMetric);
  const visibleMetrics = benchmark ? decisionMetrics(benchmark, moreMetrics, selection.metric) : [];
  const leadingMetrics = benchmark && primaryMetric
    ? [primaryMetric, ...visibleMetrics.filter(item => item.id !== primaryMetric.id && benchmark.leadingMetricIds?.includes(item.id))]
    : [];
  const trailingMetrics = benchmark
    ? visibleMetrics.filter(item => item.id !== primaryMetric?.id && !benchmark.leadingMetricIds?.includes(item.id))
    : [];
  const metricBest = new Map((benchmark?.metrics ?? []).map(item => [item.id, item.highlightBest === false ? null : bestValue((benchmark?.providers ?? []).map(provider => provider.scores[item.id]), item.direction)]));
  const categoryBest = new Map(categories.map(category => [category.id, bestValue((benchmark?.providers ?? []).map(provider => provider.categoryPassed?.[category.id] ?? null), "desc")]));
  const passedBest = bestValue((benchmark?.providers ?? []).map(provider => provider.passed), "desc");
  const showPassed = showCategories && (benchmark?.providers.some(provider => provider.passed !== null && provider.passed !== undefined) ?? false);
  const hasPricing = benchmark?.providers.some(provider => provider.pricing !== null && provider.pricing !== undefined) ?? false;
  const showPricing = hasPricing || !benchmark?.metrics.some(item => item.unit === "usd");
  const tableClass = benchmark?.id === "lexbench-webfetch"
    ? "wide-table lexbench-table"
    : benchmark?.id === "webarena-verified" ? "wide-table arena-table"
    : benchmark?.id === "lexbench-headless-372" ? "wide-table headless-table"
    : benchmark?.trackId === "websearch" ? "wide-table search-table"
    : benchmark?.trackId === "webextract" ? "wide-table extract-table"
    : "wide-table";

  function chooseBenchmark(id: string) {
    setShowCategories(false);
    setMoreMetrics(false);
    const latest = entries ? latestEntry(entries, id) : null;
    const version = latest ? canonicalVersion(latest.version) : "";
    const selectedResult = snapshots.find(record => record.id === latest?.id)?.benchmarks.find(item => item.id === id);
    const selected = catalog && selectedResult ? resolveBenchmark(catalog, selectedResult) : null;
    const primary = selected?.metrics.find(item => item.id === selected.primaryMetric);
    setSelection({ benchmark: id, version, metric: primary?.id ?? "passRate" });
    setDirection(primary?.direction ?? "desc");
    setMenuOpen(false);
    setSelectedProvider(null);
  }

  function chooseVersion(version: string) {
    setSelectedProvider(null);
    const selectedEntry = entries ? selectEntry(entries, version, selection.benchmark) : null;
    const selectedResult = snapshots.find(record => record.id === selectedEntry?.id)?.benchmarks.find(item => item.id === selection.benchmark);
    const selected = catalog && selectedResult ? resolveBenchmark(catalog, selectedResult) : null;
    const selectedMetric = selected?.metrics.find(item => item.id === selection.metric) ?? selected?.metrics.find(item => item.id === selected.primaryMetric);
    setSelection(current => ({ ...current, version, metric: selectedMetric?.id ?? current.metric }));
    if (selectedMetric && selectedMetric.id !== selection.metric) setDirection(selectedMetric.direction);
  }

  function metricDescription(item: Metric) {
    const original = details?.definitions.find(definition => definition.id === result?.definitionId)?.metrics.find(metric => metric.id === item.id);
    const sample = result?.metricSamples?.[item.id];
    return [t(original?.description ?? ""), sample?.sampleCount == null ? "" : `${sample.sampleCount} ${t("samples")}.`,
      sample?.scope === "all-search-calls" ? t("Shared across both query sets.") : "", sample?.note ? t(sample.note) : ""].filter(Boolean).join(" ");
  }

  function metricHeader(item: Metric) {
    const selected = metric?.id === item.id;
    return <th key={item.id} scope="col" aria-sort={selected ? (direction === "asc" ? "ascending" : "descending") : "none"} className={selected ? "sorted" : undefined}>
      <div className="metric-heading">
        <button className={`sort-button ${selected ? "selected" : ""}`} onClick={() => {
          setDirection(selected ? (direction === "desc" ? "asc" : "desc") : item.direction);
          setSelection(current => ({ ...current, metric: item.id }));
        }}>{t(item.label)}<ArrowDown size={13} style={{ transform: selected && direction === "asc" ? "rotate(180deg)" : undefined }} /></button>
        {item.description && <InfoTooltip label={t(item.label)} description={metricDescription(item)} detailsLabel={t("details")} />}
      </div>
    </th>;
  }

  function metricCell(provider: Provider, item: Metric) {
    const value = provider.scores[item.id];
    const isBest = isBestValue(value, metricBest.get(item.id) ?? null);
    return <td key={item.id} className={`numeric ${item.id === metric?.id ? "primary-number" : ""} ${isBest ? "best-value" : ""}`}
      title={isBest ? t("Best in this column") : value == null ? t("Not disclosed in the source") : undefined}
    >{formatMetric(value, item.unit, item.decimals, item.signed, provider.counts?.[item.id])}{isBest && <span className="sr-only"> {t("Best in this column")}</span>}</td>;
  }

  return <div className="app-shell">
    <ReleaseCheck />
    <a className="skip-link" href="#main">{t("Skip to results")}</a>
    {menuOpen && <button className="sidebar-scrim" aria-label={t("Close navigation")} onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
      <a href="/" className="brand" aria-label={t("Webstone home")}><span className="brand-heading"><Layers3 size={24} strokeWidth={1.8} /><span>Webstone</span></span><span className="brand-tagline">{t("Benchmarks for AI agents' web tools")}</span></a>
      <div className="sidebar-label">{t("TRACKS")}</div>
      <nav aria-label={t("Tracks")}>{tracks.map(item => {
        const Icon = TRACK_ICONS[item.id] ?? Layers3;
        if (item.url) return <a key={item.id} className="nav-item" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${t(item.name)} (${t("opens in a new tab")})`}>
          <Icon size={17} aria-hidden="true" /><span className="track-name">{t(item.name)}<span>{t(item.description)}</span></span><ArrowUpRight className="track-external" size={14} aria-hidden="true" />
        </a>;
        return <div key={item.id} className="nav-track"><button
          className={`nav-item ${track?.id === item.id ? "active" : ""}`}
          aria-current={track?.id === item.id ? "page" : undefined}
          onClick={() => track?.id === item.id ? setMenuOpen(false) : chooseBenchmark(item.benchmarks[0].id)}
        ><Icon size={17} /><span className="track-name">{t(item.name)}<span>{t(item.description)}</span></span></button>

        </div>;
      })}</nav>
      <div className="sidebar-footer">
        <div className="language-control" role="group" aria-label="Language / 语言"><button lang="en" aria-pressed={language === "en"} onClick={() => chooseLanguage("en")}>EN</button><button lang="zh" aria-pressed={language === "zh"} onClick={() => chooseLanguage("zh")}>中文</button></div>
        <a className="github-square" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label={t("View website source on GitHub")} title="GitHub"><Github /></a>
      </div>
    </aside>

    <div className="main-shell">
      <div className="benchmark-tabs-bar"><button className="mobile-menu icon-button" aria-label={t("Open navigation")} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>          {track && <div className="benchmark-navigation" role="group" aria-label={t("Benchmarks")}>
            {track.benchmarks.filter(bench => !bench.outputLayer || bench.outputLayer === "L1").map(bench => {
              const active = bench.searchGroup ? details?.searchGroup === bench.searchGroup : selection.benchmark === bench.id;
              return <button key={bench.id} aria-current={active ? "page" : undefined} onClick={() => {
                const target = bench.searchGroup ? catalog?.benchmarks.find(candidate => candidate.searchGroup === bench.searchGroup && candidate.outputLayer === details?.outputLayer) : bench;
                chooseBenchmark(target?.id ?? bench.id);
              }}>{bench.name}</button>;
            })}
          </div>}</div>
      <header className="topbar">
        <div className="title-group">
          <div className="benchmark-heading"><h1>{details ? t(details.name) : "Webstone"}</h1>
            {details && <p className="benchmark-description">{t(details.description)}</p>}
            {details && <div className="benchmark-links">
              <a href={details.datasetUrl} target="_blank" rel="noreferrer" aria-label={`${t("Dataset")}: ${details.datasetName}`}>{t("Dataset")}<ArrowUpRight size={13} aria-hidden="true" /></a>
              <a href={benchmark?.reportUrl ?? details.reportUrl} target="_blank" rel="noreferrer" >{t("Evaluation report")}<ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>}
          </div>
        </div>
        <div className="topbar-actions">
          {entry && <a className="download-link" href={`/results/${entry.file}`} download aria-label={t("Download Report")}><ArrowDownToLine size={17} aria-hidden="true" /><span>{t("Download Report")}</span></a>}
          <a className="submit-result-link" href="/submit">{t("SUBMIT YOUR RESULT")}</a>
        </div>
      </header>

      <main id="main" className="main-content">
        {!entries && !error && <div className="loading-panel" role="status">{t("Loading…")}</div>}
        {error && <div className="empty-state" role="alert"><p>{t(error)}</p><button className="text-button" onClick={() => window.location.reload()}>{t("Retry")}</button></div>}
        {entries && <>
          <div className="results-controls"><div className="result-meta"><span>{t("Website updated")} <time dateTime={BUILT_AT}>{BUILT_AT.slice(0, 16).replace("T", " ")} UTC</time></span>{entry && <span>{t("Version released")}: {entry.dateKind === "released" ? entry.date : t("Not recorded")}</span>}</div>
            {details?.searchGroup ? <div className="search-selectors">
              <div className="layer-control" role="group" aria-label={t("Output layer")}>{(["L1", "L2", "L3"] as const).map((layer, index) => <button key={layer} aria-pressed={details.outputLayer === layer} onClick={() => {
                const target = catalog?.benchmarks.find(item => item.searchGroup === details.searchGroup && item.outputLayer === layer);
                if (target) chooseBenchmark(target.id);
              }}>{t(["L1 · Search results", "L2 · Supplemental text", "L3 · Generated answers"][index])}</button>)}</div>
            </div> : null}
            {versions.length > 0 && <div className="version-control">
              <label htmlFor="result-version">{t("Version")}</label>
              <select id="result-version" value={selection.version} onChange={event => chooseVersion(event.target.value)}>
                {selection.version && !versions.includes(selection.version) && <option value={selection.version}>{selection.version} ({t("no results")})</option>}
                {[...versionEntries].reverse().map(item => <option key={item.version} value={canonicalVersion(item.version)}>{canonicalVersion(item.version)}{item.dateKind === "released" && item.date ? ` · ${item.date}` : ""}</option>)}
              </select>
            </div>}
          </div>

          {!benchmark || !metric ? <div className="empty-state">
            <h2>{t(versions.length > 0 ? "No results for this version" : "No results for this benchmark")}</h2>
            {versions.length > 0 && <button className="text-button" onClick={() => chooseVersion(versions.at(-1)!)}>{t("View latest version")}<ArrowRight size={14} /></button>}
          </div> : <>
            {details?.searchGroup && <p className="scope-warning">{t("Each layer is scored independently. Scores cannot be added or read as incremental gains.")}</p>}
              <details className="evaluation-notes"><summary>{t("Evaluation notes")}</summary>
                {snapshot && <p>{t(snapshot.datasetDifference)}</p>}
                {snapshot?.release && <p><strong>{canonicalVersion(snapshot.version)}</strong> · {snapshot.release.date} · {t(snapshot.release.summary)}</p>}
                {!snapshot?.release && <p>{t("Release date not recorded for this historical version.")}</p>}
                <a href="/versioning">{t("Result versioning")}</a>
                <ul>{benchmark.notes.map((note, index) => <li key={index}>{t(note)}</li>)}</ul>
                {result?.reportUrl && result.reportUrl !== details?.reportUrl && <a href={result.reportUrl} target="_blank" rel="noreferrer">{t("Source report")} ↗</a>}
              </details>
            <section id="results" className="leaderboard" aria-label={`${t(benchmark.name)} ${t("Leaderboard")}`}>
              <h2 className="sr-only">{t("Leaderboard")}</h2>
              <div className="table-toolbar"><span>{benchmark.providerCount} {t("methods")} · {benchmark.taskCount.toLocaleString()} {t("cases")}</span><div className="column-views" role="group" aria-label={t("Table columns")}>
                {benchmark.categories.length > 0 && <button aria-pressed={showCategories} onClick={() => setShowCategories(current => !current)}>{t("Category breakdown")}</button>}
                {benchmark.metrics.some(item => !decisionMetrics(benchmark, false, selection.metric).includes(item)) && <button aria-pressed={moreMetrics} onClick={() => setMoreMetrics(current => !current)}>{t("More metrics")}</button>}
              </div></div>
              <p className="sample-scope">{benchmark.metrics.filter(item => result?.metricSamples?.[item.id]?.sampleCount !== null && result?.metricSamples?.[item.id]?.sampleCount !== undefined && result.metricSamples[item.id].sampleCount !== benchmark.taskCount).map(item => `${item.label}: ${result!.metricSamples![item.id].sampleCount} ${t("samples")}`).join(" · ")}</p>
              {benchmark.trackId === "websearch" && snapshot?.source.kind === "report-page" && <p className="scope-warning">{t("Different collection dates and concurrency: these timings are not a controlled same-window speed comparison.")}</p>}
              {!hasPricing && !benchmark.metrics.some(item => item.unit === "usd") && <p className="cost-disclosure">{t("Cost was not disclosed in this report; unknown does not mean free.")}</p>}
              <div className="table-scroll">
                <table className={tableClass} style={{ "--data-columns": categories.length + visibleMetrics.length + Number(showPassed) + Number(showPricing) } as React.CSSProperties}>
                  <caption className="sr-only">{t(benchmark.name)} {t("Leaderboard")}</caption>
                  <thead><tr>
                    <th className="rank-cell" scope="col">#</th>
                    <th className="provider-heading" scope="col">{t(benchmark.providerLabel ?? "Browser")}</th>
                    {leadingMetrics.map(metricHeader)}
                    {categories.map(category => <th key={category.id} scope="col" className="category-head"><div className="metric-heading"><span>{t(category.name)}<span className="category-total">/{category.total}</span></span><InfoTooltip label={t(category.name)} description={`${category.total} ${t("cases")}. ${t("Pass criteria")}: ${t(category.criterion)}`} detailsLabel={t("details")} /></div></th>)}
                    {trailingMetrics.map(metricHeader)}
                    {showPricing && <th scope="col"><div className="metric-heading"><span>{t("Price / 1K")}</span><InfoTooltip label={t("Price / 1K")} description={t("Quoted prices and ranges are not realized total costs. Software-only prices exclude model usage.")} detailsLabel={t("details")} /></div></th>}
                    {showPassed && <th className="count-cell" scope="col"><div className="metric-heading"><span>{t("Passed / Total")}</span><InfoTooltip label={t("Passed / Total")} description={`${t("Passed / Total")}: ${benchmark.taskCount}. ${t("Not disclosed in the source")}: —.`} detailsLabel={t("details")} /></div></th>}
                  </tr></thead>
                  <tbody>{providers.map((provider, i) => <tr key={provider.id}>
                    <td className="rank-cell">{provider.scores[metric.id] == null ? "—" : i + 1}</td>
                    <td><div className="provider-cell"><a className="provider-name provider-link" href={catalog?.providerUrls[provider.id]} target="_blank" rel="noopener noreferrer" aria-label={`${provider.name} ${t("project")} (${t("opens in a new tab")})`}><span className={`provider-mark ${provider.id}`} style={{ "--provider-color": providerColors[provider.id] ?? "#64748b" } as React.CSSProperties} aria-hidden="true">{provider.name[0]}</span><span className="provider-label" title={provider.name}><strong>{provider.name.split(" · ")[0]}</strong>{provider.name.includes(" · ") && <small>{provider.name.split(" · ").slice(1).join(" · ")}</small>}</span><ArrowUpRight className="provider-external" size={12} aria-hidden="true" /></a><button className="method-open" aria-label={`${provider.name} · ${t("Method details")}`} onClick={() => setSelectedProvider(provider)}>···</button></div></td>
                    {leadingMetrics.map(item => metricCell(provider, item))}
                    {categories.map(category => {
                      const isBest = isBestValue(provider.categoryPassed?.[category.id], categoryBest.get(category.id) ?? null);
                      return <td key={category.id} className={`numeric category-value ${isBest ? "best-value" : ""}`} title={isBest ? t("Best in this column") : undefined}>{provider.categoryPassed?.[category.id] ?? "—"}{isBest && <span className="sr-only"> {t("Best in this column")}</span>}</td>;
                    })}
                    {trailingMetrics.map(item => metricCell(provider, item))}
                    {showPricing && <td className="numeric"><div className="metric-heading">{provider.pricing ? <>{t(formatPricing(provider.pricing))}<InfoTooltip label={`${provider.name} · ${t("Billing basis")}`} description={t(provider.pricing.description)} detailsLabel={t("details")} /></> : "—"}</div></td>}
                    {showPassed && <td className={`numeric count-cell ${isBestValue(provider.passed, passedBest) ? "best-value" : ""}`} title={isBestValue(provider.passed, passedBest) ? t("Best in this column") : provider.passed == null ? t("Not disclosed in the source") : provider.passedDerivation ? t(provider.passedDerivation) : undefined}>{provider.passed == null ? "—" : <>{provider.passed}<span> / {benchmark.taskCount}</span></>}{isBestValue(provider.passed, passedBest) && <span className="sr-only"> {t("Best in this column")}</span>}</td>}
                  </tr>)}</tbody>
                </table>
              </div>

            </section>
            <Insights key={`${benchmark.id}-${selection.version}`} benchmark={benchmark} t={t} />
            <MethodDetails provider={selectedProvider} benchmark={benchmark} t={t} onClose={() => setSelectedProvider(null)} />
          </>}
        </>}
      </main>
    </div>
  </div>;
}

function Github() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.63 0c2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.02 0 4.32-2.64 5.28-5.15 5.56.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" /></svg>;
}
