import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  assert.deepEqual(tracks.map(track => track.id), ["websearch", "webextract", "webfetch", "trajectory-replay"]);
  assert.deepEqual(tracks.find(track => track.id === "trajectory-replay").benchmarks.map(bench => bench.id),
    ["webarena-verified", "lexbench-headless-372"]);
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
  const { snapshot } = load("lexbench-swde");
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
    assert.equal(evaluation.querySelector("#evaluation-prompt"), null);
    assert.equal(submission.querySelector("#submission-prompt"), null);
    const cards = win.document.querySelector(".getting-started");
    assert.equal(cards.children.length, 3);
    assert.ok(cards.compareDocumentPosition(win.document.querySelector(".track-overview")) & win.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(cards.querySelector(".dataset-action").getAttribute("href"), "https://huggingface.co/datasets?author=Lexmount");
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
    assert.deepEqual(links.map(link => link.getAttribute("href")), [EVALUATION_URL, SUBMISSION_URL, "https://huggingface.co/datasets?author=Lexmount"]);
    assert.ok(links.every(link => link.querySelector("svg") && link.textContent.trim()));
    const star = container.querySelector(".sidebar-footer .nav-star");
    assert.ok(star); assert.equal(new URL(star.href).pathname, "/lexmount/webstone"); assert.equal(new URL(star.href).hash, "");
    assert.match(star.getAttribute("aria-label"), /Star Webstone/);
    const groups = [...container.querySelectorAll(".grouped-navigation > .nav-group")];
    assert.deepEqual(groups.map(group => group.querySelector("h2").textContent), ["Web Tools", "Browsers", "Browser Automation"]);
    assert.deepEqual(groups.map(group => group.querySelectorAll(".nav-track").length), [2, 2, 0]);
    assert.deepEqual(groups.map(group => group.querySelectorAll(".nav-upcoming").length), [1, 0, 1]);
    assert.equal(container.querySelectorAll(".grouped-navigation details").length, 0);
    assert.equal(container.querySelectorAll(".nav-upcoming a, .nav-upcoming button").length, 0);
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
        assert.equal(container.querySelectorAll(".metric-selector").length, 1, report.id);
        assert.equal(table.querySelectorAll("th")[1].textContent, "Method", report.id);
        assert.ok(container.querySelector("#reports"), report.id);
        for (const row of table.querySelectorAll("tbody tr")) assert.equal(row.children.length, table.querySelectorAll("th").length, report.id);

        const more = [...container.querySelectorAll(".table-controls button")].find(button => button.textContent === "More metrics");
        const definition = resolveBenchmark(catalog, report.benchmarks[0]);
        const { decisionMetrics } = require("../web/lib/comparisons.ts");
        const extras = definition.metrics.length > decisionMetrics(definition, false, definition.primaryMetric).length;
        assert.equal(Boolean(more), extras, report.id + " extra metric control");
        if (extras) {
          const initialColumns = table.querySelectorAll("th").length;
          await React.act(async () => more.click());
          assert.ok(table.querySelectorAll("th").length > initialColumns, report.id);
          const extra = definition.metrics.find(item => !decisionMetrics(definition, false, definition.primaryMetric).some(metric => metric.id === item.id));
          const extraHeader = [...table.querySelectorAll("th")].find(header => header.querySelector(".sort-button")?.textContent === extra.label);
          await React.act(async () => extraHeader.querySelector(".sort-button").click());
          const collapse = [...container.querySelectorAll(".table-controls button")].find(button => button.textContent === "More metrics");
          assert.ok(collapse, report.id + " can collapse after sorting an extra column");
          await React.act(async () => collapse.click());
          assert.equal(table.querySelectorAll("th").length, initialColumns, report.id);
        }
        assert.equal(container.querySelector('a[href="https://huggingface.co/datasets?author=Lexmount"]')?.textContent, "Datasets", report.id);
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

        const summary = chartMenu.querySelector("summary");
        chartMenu.open = true;
        await React.act(async () => container.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true })));
        assert.ok(!chartMenu.open, report.id);
        chartMenu.open = true;
        await React.act(async () => summary.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        assert.ok(!chartMenu.open, report.id);

        await React.act(async () => [...container.querySelectorAll(".language-control button")].find(button => button.textContent === "中文").click());
        assert.equal(table.querySelectorAll("th")[1].textContent, "方案", report.id);
        assert.match(chartMenu.querySelector("summary").textContent, /图表指标/, report.id);
        assert.equal(container.querySelectorAll(".table-controls .metric-selector").length, 0, report.id);
      } finally {
        await React.act(async () => root.unmount());
        await win.happyDOM.close();
      }
    }
  } finally {
    [globalThis.window, globalThis.document, globalThis.fetch, globalThis.IS_REACT_ACT_ENVIRONMENT] = previous;
  }
});


test("profiles with only two disclosed quality metrics include all available categories by default", () => {
  const { benchmark } = load("lexbench-webfetch");
  for (const provider of benchmark.providers) for (const id of ["totalMean", "totalP50", "totalP95"]) provider.scores[id] = null;
  const axes = radarAxes(benchmark);
  assert.ok(axes.filter(axis => axis.defaultSelected).length >= 3);
  const eligible = benchmark.categories.filter(category => category.total > 0 && benchmark.providers.some(provider => provider.categoryPassed?.[category.id] !== null && provider.categoryPassed?.[category.id] !== undefined)).map(category => "category:" + category.id).sort();
  const categories = axes.filter(axis => axis.id.startsWith("category:"));
  assert.deepEqual(categories.map(axis => axis.id).sort(), eligible);
  assert.ok(categories.every(axis => axis.defaultSelected));
  assert.ok(!axes.some(axis => axis.id === "totalMean"));
});

test("homepage copy actions copy the correct skill without displaying long prompts", async () => {
  const Home=require('../web/components/home.tsx').default;
  const {EVALUATION_SKILL,SUBMISSION_SKILL}=require('../web/lib/overview.ts');
  const win=new Window(); const copied=[];
  const prior=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT,Object.getOwnPropertyDescriptor(globalThis,'navigator')];
  [globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=[win,win.document,true];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>copied.push(value)}}});
  const root=require('react-dom/client').createRoot(win.document.body);
  try {
    await React.act(async()=>root.render(React.createElement(Home,{catalog,snapshots:[],t:text=>text})));
    assert.equal(win.document.querySelectorAll('textarea').length,0);
    for (const id of ['run-evaluation','submit-results']) await React.act(async()=>win.document.querySelector('#'+id+' button').click());
    assert.ok(copied[0].includes(EVALUATION_SKILL)); assert.ok(copied[1].includes(SUBMISSION_SKILL));
    assert.ok(!win.document.body.textContent.includes(EVALUATION_SKILL));
    assert.equal(win.document.querySelectorAll('textarea').length,0);
  } finally {
    await React.act(async()=>root.unmount());await win.happyDOM.close();
    [globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=prior;
    if(prior[3])Object.defineProperty(globalThis,'navigator',prior[3]);else delete globalThis.navigator;
  }
});


test("compact columns preserve ranking and disclosed resources without inventing missing measurements", () => {
  const {decisionMetrics}=require('../web/lib/comparisons.ts');
  const metric=(id,unit)=>({id,unit});
  const benchmark={primaryMetric:"quality",leadingMetricIds:["leading"],metrics:[metric("quality","ratio"),metric("time","ms"),metric("other","ratio"),metric("leading","ratio")],providers:[{scores:{quality:1,time:null,other:0.5,leading:null}}]};
  const ids=(expanded=false,selected="quality")=>decisionMetrics(benchmark,expanded,selected).map(item=>item.id);
  assert.deepEqual(ids(),["quality","leading"]);
  benchmark.providers[0].scores.time=0;assert.deepEqual(ids(),["quality","time","leading"]);
  benchmark.providers[0].scores.time=10;assert.deepEqual(ids(),["quality","time","leading"]);
  benchmark.providers[0].scores.time=null;assert.deepEqual(ids(false,"other"),["quality","other","leading"]);
  assert.deepEqual(ids(true),["quality","time","other","leading"]);
});

test("repeated denied clipboard attempts focus and select the manual prompt each time", async () => {
  const Home=require('../web/components/home.tsx').default;
  const win=new Window();const prior=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT,Object.getOwnPropertyDescriptor(globalThis,'navigator')];
  [globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=[win,win.document,true];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error("Denied");}}}});
  const root=require('react-dom/client').createRoot(win.document.body);
  try {
    await React.act(async()=>root.render(React.createElement(Home,{catalog,snapshots:[],t:text=>text})));
    const button=win.document.querySelector('#run-evaluation button');
    for(let attempt=0;attempt<2;attempt++) {
      button.focus();await React.act(async()=>button.click());
      const field=win.document.querySelector('#evaluation-prompt');
      assert.equal(win.document.activeElement,field);assert.equal(field.selectionStart,0);assert.equal(field.selectionEnd,field.value.length);
    }
  } finally {
    await React.act(async()=>root.unmount());await win.happyDOM.close();
    [globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=prior;
    if(prior[3])Object.defineProperty(globalThis,'navigator',prior[3]);else delete globalThis.navigator;
  }
});


test("release verification rejects relaxed or stale script policies", async () => {
  const {inlineScriptHashes,assertScriptPolicy}=await import('../scripts/secure-export.mjs');
  const html='<script>window.ready=true</script>';
  const expected="script-src 'self' "+inlineScriptHashes(html).join(" ")+"; frame-ancestors 'none'";
  assert.doesNotThrow(()=>assertScriptPolicy(expected,expected,html));
  for(const policy of [expected.replace(";", " https://untrusted.example;"),expected+"; script-src-elem * 'unsafe-inline'",expected+"; SCRIPT-SRC-ELEM * 'unsafe-inline'",expected+"; script-src-attr 'unsafe-inline'",expected.replace(inlineScriptHashes(html)[0],inlineScriptHashes('<script>other()</script>')[0]),expected+"; script-src *"])
    assert.throws(()=>assertScriptPolicy(policy,expected,html));
});


test("inline script hashes use HTML attributes and browser script text", async () => {
  const {inlineScriptHashes}=await import('../scripts/secure-export.mjs');
  const expected=["'sha256-"+createHash('sha256').update('run()').digest('base64')+"'"];
  assert.deepEqual(inlineScriptHashes('<script>run()</script>'),expected);
  assert.deepEqual(inlineScriptHashes('<script data-src="example">run()</script>'),expected);
  assert.deepEqual(inlineScriptHashes('<script data-label="a > b">run()</script>'),expected);
  assert.deepEqual(inlineScriptHashes('<script SRC="/external.js">run()</script>'),[]);
  assert.deepEqual(inlineScriptHashes('<script>run()\r\n</script>'),inlineScriptHashes('<script>run()\n</script>'));
});


test("navigation groups separate browser retrieval from web APIs without counting planned tracks", () => {
  const {navigationGroups}=require('../web/lib/overview.ts');
  const groups=navigationGroups(catalog);
  assert.deepEqual(groups.map(group=>group.id),["web-tools","browsers","browser-automation"]);
  assert.deepEqual(groups[0].tracks.map(track=>track.id),["websearch","webextract"]);
  assert.deepEqual(groups[1].tracks.map(track=>track.id),["webfetch","trajectory-replay","browserarena"]);
  assert.deepEqual(groups[0].upcoming.map(track=>track.id),["webfetch-api"]);
  assert.deepEqual(groups[2].upcoming.map(track=>track.id),["browser-use"]);
  assert.equal(groups[2].tracks.length,0);
  const published=trackOverview(catalog);
  assert.equal(published.length,4);assert.equal(published.flatMap(track=>track.benchmarks).length,8);
  assert.ok(groups.flatMap(group=>group.upcoming).every(item=>!published.some(track=>track.id===item.id)));
});

test("the homepage offers the evaluation repository star and translates the development preview", async () => {
  const Home=require('../web/components/home.tsx').default;
  const win=new Window();
  try {
    win.document.body.innerHTML=renderToStaticMarkup(React.createElement(Home,{catalog,snapshots:[],t:translator('zh',catalog,null)}));
    const star=win.document.querySelector('.overview-star');
    assert.equal(new URL(star.href).pathname,'/lexmount/webstone');assert.equal(new URL(star.href).hash,'');
    assert.match(star.textContent,/Star/);
    assert.match(win.document.querySelector('.overview-star-note').textContent,/觉得 Webstone 有用/);
    assert.match(win.document.querySelector('.upcoming-overview').textContent,/Browser Automation/);
    assert.match(win.document.querySelector('.upcoming-overview').textContent,/开发中/);
    assert.equal(win.document.querySelectorAll('.track-card').length,4);
  } finally {await win.happyDOM.close();}
});


test("Chinese navigation preserves technical names and translates supporting copy", () => {
  const {translator}=require('../web/lib/i18n.ts');
  const t=translator('zh',catalog);
  for (const name of ['Web Tools','Browsers','Browser Automation','Web Search','Web Extract','Web Fetch','Web Fetch API','Browser Task Replay','Browser Use']) assert.equal(t(name),name);
  assert.equal(t('Coming soon'),'开发中');
  assert.equal(t('Replay tasks across browsers'),'在不同浏览器上回放任务');
});
