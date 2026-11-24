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

// First upload timestamps from the report host site.createdAt metadata.
const reports = [
  { source: "lexbench-websearch-v2", publishedAt: "2026-10-22T06:18:04.612Z", title: "Web Search: result lists, source excerpts and generated answers", summary: "Compare ranked results, supplemental text and generated answers on two query sets.", benchmarkIds: ["lexbench-websearch", "simpleqa-verified"], versionReport: true },
  { source: "webmainbench-v1", publishedAt: "2026-10-16T14:13:21.880Z", title: "Moli leads Web Fetch with an 89.8% pass rate", summary: "Live pages test what browsers can retrieve. Frozen pages test how well they preserve text, code and tables.", benchmarkIds: ["lexbench-webfetch", "webmainbench"] },
  { source: "lexbench-websearch-v1", publishedAt: "2026-10-22T14:06:05.138Z", title: "Lexmount Web Search: retrieval quality, speed and cost", summary: "Retrieval quality, response time and quoted prices for search APIs.", benchmarkIds: ["lexbench-websearch", "simpleqa-verified"] },
  { source: "lexbench-headless-372-v1", publishedAt: "2026-09-20T09:30:59.106Z", title: "Moli 1.1.4 / 1.1.8 / 1.1.9: success and resource use", summary: "Task success, memory and mean latency across seven Moli configurations.", benchmarkIds: ["lexbench-headless-372"] },
  { source: "webarena-verified-v1", publishedAt: "2026-09-24T07:24:34.258Z", title: "WebArena-Verified: full trajectory replay with Moli", summary: "Browser task success and timing across 812 recorded trajectories.", benchmarkIds: ["webarena-verified"] },
  { source: "lexbench-swde-v1", publishedAt: "2026-11-10T09:12:50.006Z", title: "Web Extract: accuracy, speed and cost across 12 methods", summary: "Compare extraction methods on SWDE pages and Zyte product pages.", benchmarkIds: ["lexbench-swde", "lexbench-zyte-product-extraction"] },
];

export function evaluationReports(catalog: Catalog, snapshots: Snapshot[], current?: BenchmarkInfo) {
  const benches = trackOverview(catalog).flatMap(track => track.benchmarks);
  const base = current?.searchGroup
    ? benches.find(bench => bench.trackId === current.trackId && bench.searchGroup === current.searchGroup)
    : current;

  return reports.flatMap(({ source, publishedAt, title, summary, benchmarkIds, versionReport }) => {
    if (current && (!base || !benchmarkIds.includes(base.id))) return [];
    const snapshot = snapshots.find(item => item.id === source);
    const benchmarks = benches.filter(bench => benchmarkIds.includes(bench.id));
    const date = publishedAt.slice(0, 10);
    const href = versionReport ? snapshot?.benchmarks[0]?.reportUrl : benchmarks[0]?.reportUrl;
    if (!snapshot || !date || !href || !benchmarks.length) return [];
    const track = catalog.tracks.find(item => item.id === benchmarks[0].trackId);
    const trackLanding = track && benches.find(bench => bench.trackId === track.id);
    return track && trackLanding ? [{ source, title, summary, date, publishedAt, href, benchmarks, track, trackLanding }] : [];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
