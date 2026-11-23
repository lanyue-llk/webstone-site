import { historicalPublication } from "./historical-publications.ts";
import type { BenchmarkInfo, Catalog, Snapshot } from "./results.ts";

export const SUBMISSION_URL = "https://github.com/lexmount/webstone-site#for-agents";
export const SUBMISSION_SKILL = "https://github.com/lexmount/webstone-site/blob/main/.agents/skills/submit-webstone-result/SKILL.md";

export function benchmarkHref(id: string) {
  return `/?${new URLSearchParams({ benchmark: id })}`;
}

export function trackOverview(catalog: Catalog) {
  return catalog.tracks.filter(track => !track.url).map(track => {
    const views = catalog.benchmarks.filter(benchmark => benchmark.trackId === track.id);
    return { ...track, views, benchmarks: views.filter(benchmark => !benchmark.outputLayer || benchmark.outputLayer === "L1") };
  });
}

const articles = [
  { source: "lexbench-websearch-v2", title: "Web search across three output layers", summary: "Compare ranked results, supplemental text and generated answers on two query sets.", benchmarkIds: ["lexbench-websearch", "simpleqa-verified"], versionReport: true },
  { source: "webmainbench-v1", title: "How browsers retrieve web content", summary: "Live pages test what browsers can retrieve. Frozen pages test how well they preserve text, code and tables.", benchmarkIds: ["lexbench-webfetch", "webmainbench"] },
  { source: "lexbench-websearch-v1", title: "Comparing web search services", summary: "Retrieval quality, response time and quoted prices for search APIs.", benchmarkIds: ["lexbench-websearch", "simpleqa-verified"] },
  { source: "lexbench-headless-372-v1", title: "Headless browsers with layout on and off", summary: "Task success, memory and mean latency across seven Moli configurations.", benchmarkIds: ["lexbench-headless-372"] },
  { source: "webarena-verified-v1", title: "Replaying WebArena tasks", summary: "Browser task success and timing across 812 recorded trajectories.", benchmarkIds: ["webarena-verified"] },
  { source: "lexbench-swde-v1", title: "Structured extraction from web pages", summary: "Compare extraction methods on SWDE pages and Zyte product pages.", benchmarkIds: ["lexbench-swde", "lexbench-zyte-product-extraction"] },
];

export function evaluationArticles(catalog: Catalog, snapshots: Snapshot[], current?: BenchmarkInfo) {
  const benches = trackOverview(catalog).flatMap(track => track.benchmarks);
  const base = current?.searchGroup
    ? benches.find(bench => bench.trackId === current.trackId && bench.searchGroup === current.searchGroup)
    : current;

  return articles.flatMap(({ source, title, summary, benchmarkIds, versionReport }) => {
    if (current && (!base || !benchmarkIds.includes(base.id))) return [];
    const snapshot = snapshots.find(item => item.id === source);
    const benchmarks = benches.filter(bench => benchmarkIds.includes(bench.id));
    const date = snapshot?.release?.date ?? historicalPublication(source)?.date;
    const href = versionReport ? snapshot?.benchmarks[0]?.reportUrl : benchmarks[0]?.reportUrl;
    if (!snapshot || !date || !href || !benchmarks.length) return [];
    const track = catalog.tracks.find(item => item.id === benchmarks[0].trackId);
    const trackLanding = track && benches.find(bench => bench.trackId === track.id);
    return track && trackLanding ? [{ source, title, summary, date, href, benchmarks, track, trackLanding }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
}
