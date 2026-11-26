import reportMetadata from "../../reports/metadata.json";
import type { Language } from "./i18n.ts";
import type { BenchmarkInfo, Catalog, Snapshot } from "./results.ts";

export const DATASETS_URL = "https://huggingface.co/datasets?author=Lexmount";

export const WEBSTONE_REPOSITORY_URL = "https://github.com/lexmount/webstone";
export const EVALUATION_URL = WEBSTONE_REPOSITORY_URL + "#for-agents";
export const EVALUATION_SKILL = "https://github.com/lexmount/webstone/blob/main/.agents/skills/webstone/SKILL.md";

export const SUBMISSION_URL = "https://github.com/lexmount/webstone-site#for-agents";
export const SUBMISSION_SKILL = "https://github.com/lexmount/webstone-site/blob/main/.agents/skills/submit-webstone-result/SKILL.md";

export function trackHref(id: string) {
  return `/?${new URLSearchParams({track: id})}`;
}

export function benchmarkHref(id: string) {
  return `/?${new URLSearchParams({ benchmark: id })}`;
}

export function navigationGroups(catalog: Catalog) {
  const groups = catalog.navigationGroups ?? [{ id: "tracks", name: "Tracks", description: "" }];
  return groups.map(group => ({
    ...group,
    upcoming: group.upcoming ?? [],
    tracks: catalog.tracks.filter(track => !catalog.navigationGroups || track.groupId === group.id).map(track => ({
      ...track, benchmarks: catalog.benchmarks.filter(benchmark => benchmark.trackId === track.id),
    })),
  }));
}

export function trackOverview(catalog: Catalog) {
  return navigationGroups(catalog).flatMap(group => group.tracks.filter(track => !track.url).map(track => ({
    ...track, groupName: group.name, views: track.benchmarks,
    benchmarks: track.benchmarks.filter(benchmark => !benchmark.outputLayer || benchmark.outputLayer === "L1"),
  })));
}

type ReportMetadata = {
  publishedAt: string;
  title: string;
  summary: string;
  benchmarkIds: string[];
  versionReport?: boolean;
  urls?: Partial<Record<Language, string>>;
  originalLanguage?: string;
};
const reports: Record<string, ReportMetadata> = reportMetadata.reports;

export function reportDestination(metadata: Pick<ReportMetadata, "urls" | "originalLanguage">, fallback: string, language: Language) {
  const available = metadata.urls?.[language];
  if (available) return { href: available, language };
  const originalLanguage = metadata.originalLanguage;
  if (originalLanguage === "en" || originalLanguage === "zh") return { href: fallback, language: originalLanguage };
  return { href: fallback, language: undefined };
}

export function evaluationReports(catalog: Catalog, snapshots: Snapshot[], current?: BenchmarkInfo, language: Language = "en") {
  const benches = trackOverview(catalog).flatMap(track => track.benchmarks);
  const base = current?.searchGroup
    ? benches.find(bench => bench.trackId === current.trackId && bench.searchGroup === current.searchGroup)
    : current;

  return Object.entries(reports).flatMap(([source, { publishedAt, title, summary, benchmarkIds, versionReport, urls, originalLanguage }]) => {
    if (current && (!base || !benchmarkIds.includes(base.id))) return [];
    const snapshot = snapshots.find(item => item.id === source);
    const benchmarks = benches.filter(bench => benchmarkIds.includes(bench.id));
    const date = publishedAt.slice(0, 10);
    const href = versionReport ? snapshot?.benchmarks[0]?.reportUrl : benchmarks[0]?.reportUrl;
    if (!snapshot || !date || !href || !benchmarks.length) return [];
    const destination = reportDestination({ urls, originalLanguage }, href, language);
    const track = catalog.tracks.find(item => item.id === benchmarks[0].trackId);
    const trackLanding = track && benches.find(bench => bench.trackId === track.id);
    return track && trackLanding ? [{ source, title, summary, date, publishedAt, href: destination.href, language: destination.language, benchmarks, track, trackLanding }] : [];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
