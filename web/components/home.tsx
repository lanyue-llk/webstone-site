"use client";

import { useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpenText, Bot, Clipboard, FileJson2, Globe2, Layers3, Search } from "lucide-react";
import { benchmarkHref, evaluationReports, SUBMISSION_SKILL, SUBMISSION_URL, trackOverview } from "../lib/overview";
import type { BenchmarkInfo, Catalog, Snapshot } from "../lib/results";

type Props = { catalog: Catalog; snapshots: Snapshot[]; t: (value: string) => string };
export const TRACK_ICONS: Record<string, typeof Globe2> = { webfetch: Globe2, websearch: Search, "trajectory-replay": Bot, webextract: FileJson2 };

export function EvaluationReports({ catalog, snapshots, t, current }: Props & { current?: BenchmarkInfo }) {
  const reports = evaluationReports(catalog, snapshots, current);
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(reports.length / 6);
  const selectedPage = Math.min(page, Math.max(0, pageCount - 1));
  if (reports.length === 0) return null;
  return <section className="evaluation-articles" id="reports" aria-labelledby="reports-heading">
    <h2 id="reports-heading">{t("Reports")}</h2>
    <div className="article-grid">{reports.slice(selectedPage * 6, (selectedPage + 1) * 6).map(article => {
      const Icon = TRACK_ICONS[article.track.id] ?? BookOpenText;
      return <article key={article.source} className="article-card" data-track={article.track.id}>
        <div className="article-topic"><Icon size={18} aria-hidden="true" /><span>{t(article.track.name)}</span></div>
        <h3><a href={article.href} target="_blank" rel="noreferrer">{t(article.title)} <ArrowUpRight size={15} aria-hidden="true" /><span className="sr-only"> ({t("opens in a new tab")})</span></a></h3>
        <p>{t(article.summary)}</p>
        <div className="article-date">{t("Published")} <time dateTime={article.publishedAt}>{article.date}</time><span className="report-date-source">{t("First uploaded to Yours · UTC")}</span></div>
        <div className="article-related"><span>{t("Track")}</span><a href={benchmarkHref(article.trackLanding.id)}>{t(article.track.name)} <ArrowRight size={12} aria-hidden="true" /></a></div>
        <div className="article-tags">
          <span className="article-related-label">{t("Benchmarks")}</span>
          {article.benchmarks.map(benchmark => <a key={benchmark.id} href={benchmarkHref(benchmark.id)}>{t(benchmark.name)} <ArrowRight size={12} aria-hidden="true" /></a>)}
        </div>
        <a className="article-read" href={article.href} target="_blank" rel="noreferrer">{t("Read report")} <ArrowUpRight size={15} aria-hidden="true" /></a>
      </article>;
    })}</div>
    {pageCount > 1 && <nav className="report-pagination" aria-label={t("Report pages")}>
      <button disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)}>{t("Previous")}</button>
      <span role="status">{selectedPage + 1} / {pageCount}</span>
      <button disabled={selectedPage + 1 === pageCount} onClick={() => setPage(selectedPage + 1)}>{t("Next")}</button>
    </nav>}
  </section>;
}

export default function Home({ catalog, snapshots, t }: Props) {
  const tracks = trackOverview(catalog);
  const count = tracks.reduce((sum, track) => sum + track.benchmarks.length, 0);
  const maxBenchmarks = Math.max(1, ...tracks.map(track => track.benchmarks.length));
  const firstBenchmark = tracks.flatMap(track => track.benchmarks)[0];
  const [copyStatus, setCopyStatus] = useState("");
  const prompt = t("Install the Webstone submission skill at {skill} and use it to submit these benchmark results and public evidence as a pull request to lexmount/webstone-site.").replace("{skill}", SUBMISSION_SKILL);

  async function copyPrompt() {
    const field = document.getElementById("submission-prompt");
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const selection = window.getSelection();
      if (!field || !selection) return;
      field.focus();
      const range = document.createRange();
      range.selectNodeContents(field);
      selection.removeAllRanges();
      selection.addRange(range);
      setCopyStatus("Select and copy the prompt below.");
      return;
    }
    setCopyStatus("Prompt copied");
  }

  return <div className="overview">
    <section className="overview-hero">
      <div>
        <h1>Webstone</h1>
        <p>{t("The touchstone for your agent's web tools.")}</p>
        <div className="overview-actions">
          {firstBenchmark && <a href={benchmarkHref(firstBenchmark.id)} className="overview-primary">{t("Explore leaderboards")} <ArrowRight size={17} aria-hidden="true" /></a>}
          <a href="#submit-results">{t("Submit results")}</a>
        </div>
      </div>
      <dl className="overview-stats">
        <div><dt>{t("Local tracks")}</dt><dd>{tracks.length}</dd></div>
        <div><dt>{t("Benchmarks")}</dt><dd>{count}</dd></div>
        <div><dt>{t("Result editions")}</dt><dd>{snapshots.length}</dd></div>
      </dl>
    </section>
    <section className="track-overview" aria-labelledby="track-overview-heading">
      <h2 id="track-overview-heading">{t("Explore by track")}</h2>
      <div className="track-overview-grid">{tracks.map(track => {
        const Icon = TRACK_ICONS[track.id] ?? Layers3;
        const landing = track.benchmarks[0];
        if (!landing) return null;
        return <div key={track.id} className="track-card" data-track={track.id}>
          <h3><a href={benchmarkHref(landing.id)}><Icon size={18} aria-hidden="true" />{t(track.name)}<ArrowRight size={15} aria-hidden="true" /></a></h3>
          <div className="track-volume" aria-label={`${track.benchmarks.length} ${t("Benchmarks")}`}>
            {Array.from({ length: maxBenchmarks }, (_, index) => <span key={index} className={index < track.benchmarks.length ? "filled" : ""} aria-hidden="true" />)}
          </div>
          <p className="track-volume-label">{track.benchmarks.length} {t("benchmarks")}</p>
          <ul>{track.benchmarks.map(benchmark => <li key={benchmark.id}><a href={benchmarkHref(benchmark.id)}>{t(benchmark.name)}</a></li>)}</ul>
        </div>;
      })}</div>
    </section>
    <EvaluationReports catalog={catalog} snapshots={snapshots} t={t} />
    <section className="overview-submit" id="submit-results" aria-labelledby="submission-heading">
      <div>
        <h2 id="submission-heading">{t("Submit results")}</h2>
        <p>{t("Give your agent the prompt and your measured results.")}</p>
        <a href={SUBMISSION_URL} target="_blank" rel="noreferrer">{t("Submission instructions on GitHub")} <ArrowUpRight size={14} aria-hidden="true" /></a>
      </div>
      <div className="prompt-panel">
        <button type="button" onClick={copyPrompt}><Clipboard size={16} aria-hidden="true" />{t(copyStatus === "Prompt copied" ? copyStatus : "Copy prompt")}</button>
        <span className="sr-only" role="status">{copyStatus && t(copyStatus)}</span>
        <p id="submission-prompt" tabIndex={-1}>{prompt}</p>
        {copyStatus === "Select and copy the prompt below." && <p className="copy-hint">{t("Prompt selected. Use your device’s copy command.")}</p>}
      </div>
    </section>
  </div>;
}
