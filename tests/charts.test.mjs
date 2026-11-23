import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";

const require = createRequire(import.meta.url);
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => {
  module._compile(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file);
};
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const Insights = require("../web/components/insights.tsx").default;
const { translator } = require("../web/lib/i18n.ts");
const { radarAxes } = require("../web/lib/radar.ts");
const { evaluationArticles, trackOverview } = require("../web/lib/overview.ts");
const { resolveBenchmark } = require("../web/lib/results.ts");
const { historicalResultCopy } = require("../web/lib/result-copy.ts");
const catalog = JSON.parse(readFileSync(new URL("../benchmarks/catalog.json", import.meta.url)));

function load(id, version = "v1") {
  const snapshot = JSON.parse(readFileSync(new URL(`../results/${id}/${id}-${version}-report.json`, import.meta.url)));
  return { snapshot, benchmark: resolveBenchmark(catalog, snapshot.benchmarks[0]) };
}

const component = (benchmark, t = text => text) => React.createElement(Insights, { benchmark, t });
const render = (benchmark, t) => renderToStaticMarkup(component(benchmark, t));

test("Web Fetch compares overall quality and timings without adding a second table", () => {
  const { snapshot, benchmark } = load("lexbench-webfetch");
  const html = render(benchmark, translator("zh", catalog, snapshot));
  assert.match(html, /role="img" aria-label="能力对比"/);
  assert.deepEqual(radarAxes(benchmark).map(axis => axis.id), ["passRate", "requestRate", "totalMean", "totalP95"]);
  assert.equal(radarAxes(benchmark, true).length, 7);
  assert.equal((html.match(/class="radar-shape"/g) ?? []).length, 6);
  assert.doesNotMatch(html, /<table|<select|disabled/);
});

test("all published bench views have a radar and keep each method visible when a measurement is missing", async () => {
  const { discoverResults } = await import("../scripts/prepare-data.mjs");
  const { fileURLToPath } = await import("node:url");
  const files = await discoverResults(fileURLToPath(new URL("../results", import.meta.url)), catalog);
  for (const { file } of files) {
    const snapshot = JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url)));
    const benchmark = resolveBenchmark(catalog, snapshot.benchmarks[0]);
    const html = render(benchmark);
    assert.match(html, /aria-label="Capability profile"/, file);
    assert.equal((html.match(/class="radar-series"/g) ?? []).length, benchmark.providers.length, file);
    assert.ok(radarAxes(benchmark).length >= 3, file);
    assert.doesNotMatch(html, /NaN|Infinity/, file);
  }

  const { benchmark } = load("webmainbench");
  const [first, ...otherProviders] = benchmark.providers;
  const report = { ...benchmark, providers: [
    { ...first, scores: { ...first.scores, [benchmark.primaryMetric]: null } },
    ...otherProviders,
  ] };
  const incomplete = render(report);
  assert.match(incomplete, /class="radar-label"[^>]*><tspan[^>]*>Formulas/);
  assert.equal((incomplete.match(/class="radar-series"/g) ?? []).length, benchmark.providers.length);
  assert.equal((incomplete.match(/class="radar-shape"/g) ?? []).length, benchmark.providers.length - 1);
});

test("radar includes mean latency, memory and disclosed costs, with lower values plotted farther out", () => {
  const { benchmark: headless } = load("lexbench-headless-372");
  assert.deepEqual(radarAxes(headless).map(axis => axis.id), ["successRate", "latency", "pss"]);
  const { benchmark: search } = load("lexbench-websearch", "v2");
  const axes = radarAxes(search);
  assert.ok(axes.some(axis => axis.id === "meanTime"));
  const cost = axes.find(axis => axis.id === "pricePerThousand");
  const byCost = [...search.providers].sort((a, b) => a.scores.pricePerThousand - b.scores.pricePerThousand);
  assert.ok(cost.value(byCost[0])[0] > cost.value(byCost.at(-1))[0]);

  const { benchmark: extraction } = load("lexbench-swde");
  const quote = radarAxes(extraction).find(axis => axis.id === "quoted-price");
  const ranged = extraction.providers.find(provider => typeof provider.pricing?.min === "number" && provider.pricing.min < provider.pricing.max);
  const unknown = extraction.providers.find(provider => typeof provider.pricing?.min !== "number");
  assert.ok(quote.value(ranged)[0] < quote.value(ranged)[1]);
  assert.equal(quote.value(unknown), null);
  const html = render(extraction);
  assert.match(html, /class="radar-range"/);
  assert.equal((html.match(/class="radar-shape"/g) ?? []).length,
    extraction.providers.filter(provider => typeof provider.pricing?.min === "number" &&
      provider.pricing.min === provider.pricing.max).length);
});

test("the home overview counts search layers as views and shares articles with their benchmark pages", async () => {
  const { discoverResults } = await import("../scripts/prepare-data.mjs");
  const { fileURLToPath } = await import("node:url");
  const reports = await discoverResults(fileURLToPath(new URL("../results", import.meta.url)), catalog);
  const snapshots = reports.map(({ file }) => JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url))));
  const tracks = trackOverview(catalog);
  assert.equal(tracks.length, 4);
  assert.equal(tracks.flatMap(track => track.benchmarks).length, 8);
  assert.equal(tracks.flatMap(track => track.views).length, 12);
  const articles = evaluationArticles(catalog, snapshots);
  assert.ok(articles.every((article, i) => i === 0 || article.date <= articles[i - 1].date));
  assert.equal(new Set(articles.map(article => article.href)).size, articles.length);
  for (const view of catalog.benchmarks) {
    const related = evaluationArticles(catalog, snapshots, view);
    assert.ok(related.length, view.id);
    assert.ok(related.every(article => article.benchmarks.some(bench => bench.id === view.id ||
      (view.searchGroup && bench.trackId === view.trackId && bench.searchGroup === view.searchGroup))), view.id);
  }
});

test("the radar starts with all series and lets readers hide or show each one", async () => {
  const { benchmark } = load("lexbench-webfetch");
  const win = new Window();
  const previous = [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT];
  [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = [win, win.document, true];
  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = require("react-dom/client").createRoot(container);

  try {
    await React.act(async () => root.render(component(benchmark)));
    const filters = [...container.querySelectorAll(".radar-legend input")];
    assert.equal(filters.length, 6);
    assert.ok(filters.every(filter => filter.checked && !filter.disabled));
    for (const filter of filters) await React.act(async () => filter.click());
    assert.equal(container.querySelectorAll(".radar-shape").length, 0);
    assert.match(container.textContent, /Select a method to show its results/);
    for (const filter of filters.slice(0, 5)) await React.act(async () => filter.click());
    assert.equal(container.querySelectorAll(".radar-shape").length, 5);
    const categories = [...container.querySelectorAll("button")].find(button => button.textContent === "Category breakdown");
    await React.act(async () => categories.click());
    assert.equal(container.querySelectorAll(".radar-axis").length, 7);
    assert.equal(container.querySelectorAll(".radar-shape").length, 5);
  } finally {
    await React.act(async () => root.unmount());
    await win.happyDOM.close();
    [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = previous;
  }
});

test("published historical editions have Chinese and English evaluation notes", async () => {
  const { discoverResults } = await import("../scripts/prepare-data.mjs");
  const { fileURLToPath } = await import("node:url");
  const files = await discoverResults(fileURLToPath(new URL("../results", import.meta.url)), catalog);
  for (const { file } of files) {
    const snapshot = JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url)));
    for (const language of ["en", "zh"]) {
      const copy = historicalResultCopy(snapshot.id, language);
      if (!snapshot.release) assert.ok(copy?.scope && copy.notes.every(note => note.trim()), file);
    }
  }
});
