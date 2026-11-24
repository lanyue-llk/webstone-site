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
const { evaluationReports, trackOverview } = require("../web/lib/overview.ts");
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
  assert.deepEqual(radarAxes(benchmark).filter(axis => axis.defaultSelected).map(axis => axis.id), ["passRate", "requestRate", "totalMean", "totalP95"]);
  assert.equal(radarAxes(benchmark).filter(axis => axis.id.startsWith("category:")).length, 7);
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

test("radars include latency and memory while keeping quoted prices out of capability comparisons", () => {
  const { benchmark: headless } = load("lexbench-headless-372");
  assert.deepEqual(radarAxes(headless).map(axis => axis.id), ["successRate", "latency", "pss"]);
  for (const benchmark of [load("lexbench-websearch", "v2").benchmark,
    load("lexbench-swde").benchmark, load("lexbench-zyte-product-extraction").benchmark]) {
    const axes = radarAxes(benchmark);
    assert.ok(axes.some(axis => axis.id === "meanTime"));
    assert.ok(!axes.some(axis => ["pricePerThousand", "quoted-price"].includes(axis.id)));
    assert.equal((render(benchmark).match(/class="radar-series"/g) ?? []).length, benchmark.providers.length);
  }
  const { benchmark: search } = load("lexbench-websearch", "v2");
  const measured = { ...search, metrics: [...search.metrics, { id: "totalCost", label: "Measured cost", unit: "usd", direction: "asc" }],
    providers: search.providers.map((provider, i) => ({ ...provider, scores: { ...provider.scores, totalCost: i + 1 } })) };
  assert.ok(radarAxes(measured).some(axis => axis.id === "totalCost"));
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
  const articles = evaluationReports(catalog, snapshots);
  assert.ok(articles.every((article, i) => i === 0 || article.date <= articles[i - 1].date));
  assert.equal(new Set(articles.map(article => article.href)).size, articles.length);
  assert.equal(articles[0].date, "2026-11-10");
  assert.equal(articles.at(-1).date, "2026-09-20");
  assert.ok(articles.every(report => Number.isFinite(Date.parse(report.publishedAt))));
  assert.deepEqual(tracks.map(track => track.id), ["webfetch", "websearch", "webextract", "trajectory-replay"]);
  for (const view of catalog.benchmarks) {
    const related = evaluationReports(catalog, snapshots, view);
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
    const metricOptions = [...container.querySelectorAll(".metric-selector-panel label")];
    const median = metricOptions.find(option => option.textContent === "P50 latency").querySelector("input");
    await React.act(async () => median.click());
    assert.equal(container.querySelectorAll(".radar-axis").length, 5);
    const reset = container.querySelector(".metric-selector-panel button");
    await React.act(async () => reset.click());
    assert.equal(container.querySelectorAll(".radar-axis").length, 4);
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

test("report pagination keeps a growing archive to six cards and exposes every report", async (t) => {
  const overview = require("../web/lib/overview.ts");
  const { snapshot } = load("lexbench-websearch", "v2");
  const template = overview.evaluationReports(catalog, [snapshot])[0];
  const reports = Array.from({ length: 15 }, (_, index) => ({ ...template, source: `report-${index}`, title: `Report ${index + 1}` }));
  t.mock.method(overview, "evaluationReports", () => reports);
  const { EvaluationReports } = require("../web/components/home.tsx");
  const win = new Window();
  const previous = [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT];
  [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = [win, win.document, true];
  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = require("react-dom/client").createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(EvaluationReports, { catalog, snapshots: [], t: text => text })));
    const buttons = () => [...container.querySelectorAll(".report-pagination button")];
    const titles = () => [...container.querySelectorAll("h3")].map(el => el.textContent);
    assert.equal(titles().length, 6);
    assert.ok(buttons()[0].disabled);
    assert.match(titles()[0], /Report 1 /);
    await React.act(async () => buttons()[1].click());
    assert.equal(titles().length, 6);
    assert.match(titles()[0], /Report 7 /);
    await React.act(async () => buttons()[1].click());
    assert.equal(titles().length, 3);
    assert.match(titles()[2], /Report 15 /);
    assert.ok(buttons()[1].disabled);
    await React.act(async () => buttons()[0].click());
    assert.match(titles()[0], /Report 7 /);
  } finally {
    await React.act(async () => root.unmount());
    await win.happyDOM.close();
    [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = previous;
  }
});

test("the homepage directs evaluation and result submission to their own repositories and skills", async () => {
  const Home = require("../web/components/home.tsx").default;
  const { EVALUATION_URL, EVALUATION_SKILL, SUBMISSION_URL, SUBMISSION_SKILL } = require("../web/lib/overview.ts");
  const win = new Window();
  try {
    win.document.body.innerHTML = renderToStaticMarkup(React.createElement(Home, { catalog, snapshots: [], t: text => text }));
    const evaluation = win.document.querySelector("#run-evaluation");
    const submission = win.document.querySelector("#submit-results");
    assert.equal(evaluation.querySelector("a").getAttribute("href"), EVALUATION_URL);
    assert.equal(submission.querySelector("a").getAttribute("href"), SUBMISSION_URL);
    assert.ok(evaluation.querySelector("#evaluation-prompt").textContent.includes(EVALUATION_SKILL));
    assert.ok(submission.querySelector("#submission-prompt").textContent.includes(SUBMISSION_SKILL));
    assert.ok(!evaluation.querySelector("#evaluation-prompt").textContent.includes(SUBMISSION_SKILL));
    assert.equal(evaluation.querySelectorAll("button").length, 1);
    assert.equal(submission.querySelectorAll("button").length, 1);
  } finally {
    await win.happyDOM.close();
  }
});

test("the dashboard exposes two repository guides and preserves each pricing value in its own cell", async () => {
  const { prepareData } = await import("../scripts/prepare-data.mjs");
  await prepareData();
  const Dashboard = require("../web/components/dashboard.tsx").default;
  const { EVALUATION_URL, SUBMISSION_URL } = require("../web/lib/overview.ts");
  const { formatPricing } = require("../web/lib/results.ts");
  const { RELEASE } = require("../web/lib/release.generated.ts");
  const { snapshot, benchmark } = load("lexbench-swde");
  const win = new Window({ url: "https://webstone.test/?benchmark=lexbench-swde" });
  const previous = [globalThis.window, globalThis.document, globalThis.fetch, globalThis.IS_REACT_ACT_ENVIRONMENT];
  [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = [win, win.document, true];
  globalThis.fetch = async input => {
    const url = String(input);
    let data = { release: RELEASE };
    if (url.includes("/benchmarks/catalog.json")) data = catalog;
    if (url.includes("/results/reports.json")) data = [{ file: "lexbench-swde/lexbench-swde-v1-report.json", report: snapshot }];
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  };
  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = require("react-dom/client").createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(Dashboard)));
    const links = [...container.querySelectorAll(".sidebar-guides a")];
    assert.deepEqual(links.map(link => link.getAttribute("href")), [EVALUATION_URL, SUBMISSION_URL]);
    assert.ok(links.every(link => link.querySelector("svg") && link.textContent.trim()));
    assert.equal(container.querySelectorAll(".sidebar-footer a").length, 0);
    const rows = [...container.querySelectorAll("tbody tr")];
    assert.equal(rows.length, benchmark.providers.length);
    for (const row of rows) {
      const providerLink = row.querySelector(".provider-link");
      const provider = benchmark.providers.find(item => providerLink.getAttribute("aria-label").startsWith(item.name + " "));
      const pricing = row.querySelector(".pricing-cell");
      assert.ok(pricing);
      if (provider.pricing) assert.equal(pricing.querySelector(".pricing-value")?.textContent, formatPricing(provider.pricing));
    }
    assert.ok(![...container.querySelectorAll(".radar-label")].some(label => /Price|cost/i.test(label.textContent)));
  } finally {
    await React.act(async () => root.unmount());
    await win.happyDOM.close();
    [globalThis.window, globalThis.document, globalThis.fetch, globalThis.IS_REACT_ACT_ENVIRONMENT] = previous;
  }
});

test("every published benchmark edition shares table and radar controls in both languages", async () => {
  const { prepareData, discoverResults } = await import("../scripts/prepare-data.mjs");
  const { fileURLToPath } = await import("node:url");
  await prepareData();
  const Dashboard = require("../web/components/dashboard.tsx").default;
  const { RELEASE } = require("../web/lib/release.generated.ts");
  const files = await discoverResults(fileURLToPath(new URL("../results", import.meta.url)), catalog);
  const reports = files.map(({ file }) => ({ file, report: JSON.parse(readFileSync(new URL("../results/" + file, import.meta.url))) }));
  const previous = [globalThis.window, globalThis.document, globalThis.fetch, globalThis.IS_REACT_ACT_ENVIRONMENT];

  try {
    for (const { report } of reports) {
      const id = report.benchmarks[0].id;
      const win = new Window({ url: "https://webstone.test/?benchmark=" + id + "&version=" + report.version });
      [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = [win, win.document, true];
      globalThis.fetch = async input => {
        const path = String(input);
        let data = { release: RELEASE };
        if (path.includes("/benchmarks/catalog.json")) data = catalog;
        if (path.includes("/results/reports.json")) data = reports;
        return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
      };
      const container = win.document.createElement("div");
      win.document.body.append(container);
      const root = require("react-dom/client").createRoot(container);
      try {
        await React.act(async () => root.render(React.createElement(Dashboard)));
        const table = container.querySelector("table");
        assert.equal(table.className, "wide-table", report.id);
        assert.equal(container.querySelectorAll(".metric-selector").length, 2, report.id);
        assert.equal(table.querySelectorAll("th")[1].textContent, "Method", report.id);
        assert.ok(container.querySelector("#reports"), report.id);
        for (const row of table.querySelectorAll("tbody tr")) assert.equal(row.children.length, table.querySelectorAll("th").length, report.id);

        const tableMenu = container.querySelector(".table-controls .metric-selector");
        const initialColumns = table.querySelectorAll("th").length;
        const inputs = [...tableMenu.querySelectorAll("input")];
        const option = inputs.find(input => !input.disabled && !input.checked) ?? inputs.find(input => !input.disabled);
        assert.ok(option, report.id);
        const wasChecked = option.checked;
        await React.act(async () => option.click());
        assert.equal(table.querySelectorAll("th").length, initialColumns + (wasChecked ? -1 : 1), report.id);
        await React.act(async () => tableMenu.querySelector("button").click());
        assert.equal(table.querySelectorAll("th").length, initialColumns, report.id);

        const chartMenu = container.querySelector(".radar-heading .metric-selector");
        const initialAxes = container.querySelectorAll(".radar-axis").length;
        assert.ok(initialAxes >= 3, report.id);
        for (const input of [...chartMenu.querySelectorAll("input")].filter(input => input.checked)) {
          await React.act(async () => input.click());
        }
        assert.equal(container.querySelectorAll(".radar-axis").length, 0, report.id);
        assert.match(container.querySelector(".chart-empty").textContent, /at least three/, report.id);
        await React.act(async () => chartMenu.querySelector("button").click());
        assert.equal(container.querySelectorAll(".radar-axis").length, initialAxes, report.id);

        const summary = tableMenu.querySelector("summary");
        tableMenu.open = true;
        await React.act(async () => container.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true })));
        assert.ok(!tableMenu.open, report.id);
        tableMenu.open = true;
        await React.act(async () => summary.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        assert.ok(!tableMenu.open, report.id);

        await React.act(async () => [...container.querySelectorAll(".language-control button")].find(button => button.textContent === "中文").click());
        assert.equal(table.querySelectorAll("th")[1].textContent, "方案", report.id);
        assert.match(chartMenu.querySelector("summary").textContent, /图表指标/, report.id);
        assert.match(tableMenu.querySelector("summary").textContent, /表格指标/, report.id);
      } finally {
        await React.act(async () => root.unmount());
        await win.happyDOM.close();
      }
    }
  } finally {
    [globalThis.window, globalThis.document, globalThis.fetch, globalThis.IS_REACT_ACT_ENVIRONMENT] = previous;
  }
});
