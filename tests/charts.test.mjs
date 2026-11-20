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
const { resolveBenchmark } = require("../web/lib/results.ts");
const { historicalResultCopy } = require("../web/lib/result-copy.ts");
const catalog = JSON.parse(readFileSync(new URL("../benchmarks/catalog.json", import.meta.url)));

function load(id, version = "v1") {
  const snapshot = JSON.parse(readFileSync(new URL(`../results/${id}/${id}-${version}-report.json`, import.meta.url)));
  return { snapshot, benchmark: resolveBenchmark(catalog, snapshot.benchmarks[0]) };
}

const component = (benchmark, t = text => text) => React.createElement(Insights, { benchmark, t });
const render = (benchmark, t) => renderToStaticMarkup(component(benchmark, t));

test("Headless Browser shows separate quality, latency and memory plots for every build", () => {
  const { benchmark } = load("lexbench-headless-372");
  const html = render(benchmark);
  for (const panel of ["quality", "latency", "memory"]) assert.match(html, new RegExp(`scope="col"[^>]*data-panel="${panel}"`));
  assert.equal((html.match(/scope="row"/g) ?? []).length, 7);
  assert.doesNotMatch(html, /data-panel="price"|disabled|Select up to three/);
});

test("a quality-only report uses its published submetrics instead of drawing empty latency or price plots", () => {
  const html = render(load("webmainbench").benchmark);
  assert.match(html, /data-panel="quality"/);
  assert.match(html, /aria-label="Quality breakdown"/);
  assert.match(html, /<option value="formula">/);
  assert.doesNotMatch(html, /data-panel="(latency|price|memory)"/);
});

test("extraction quotes retain ranges, and software-only pricing has no dot on the cost scale", () => {
  const { benchmark } = load("lexbench-swde");
  const doc = new Window().document;
  doc.body.innerHTML = render(benchmark);
  const costCells = [...doc.querySelectorAll('td[data-panel="price"]')];
  assert.ok(costCells.some(cell => cell.querySelector(".plot-range") && /\$[\d.]+–[\d.]+/.test(cell.textContent)));
  assert.ok(costCells.some(cell => /Software \$0 \+ model/.test(cell.textContent) && !cell.querySelector(".plot-axis")));
  assert.equal(costCells.length, 10);
  const zero = { ...benchmark.providers[0], pricing: { min: 0, max: 0, description: "No charge" } };
  assert.match(render({ ...benchmark, providers: [zero] }), /data-panel="price"><div class="plot-cell"><span class="plot-value">\$0<\/span>.*class="plot-dot"/);
});

test("changing billing units and filtering methods preserves aligned rows and scales", async () => {
  const { benchmark } = load("lexbench-websearch", "v2");
  const win = new Window();
  const previous = [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT];
  [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = [win, win.document, true];
  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = require("react-dom/client").createRoot(container);
  const rows = () => [...container.querySelectorAll("tbody tr")];
  const getRow = name => rows().find(row => row.querySelector("th").textContent.startsWith(name));
  const price = row => row.querySelector('[data-panel="price"]');
  const tick = () => container.querySelector('th[data-panel="price"] .plot-scale').textContent;

  try {
    await React.act(async () => root.render(component(benchmark)));
    const selector = container.querySelector('[aria-label="Pricing"]');
    assert.equal(selector.value, "requests");
    assert.equal(rows().length, 9);
    assert.match(price(getRow("Lexmount Search")).textContent, /\$0\.75/);
    assert.equal(price(getRow("Yuanbao Search")).textContent, "—");
    const order = rows().map(row => row.querySelector("th").textContent);
    await React.act(async () => {
      selector.value = "successful searches";
      selector.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
    assert.deepEqual(rows().map(row => row.querySelector("th").textContent), order);
    assert.equal(price(getRow("Lexmount Search")).textContent, "—");
    assert.match(price(getRow("Yuanbao Search")).textContent, /\$3\.00/);

    const range = tick();
    const filters = [...container.querySelectorAll('.comparison-methods input')];
    assert.ok(filters.every(filter => filter.checked && !filter.disabled));
    for (const filter of filters) await React.act(async () => filter.click());
    assert.match(container.textContent, /Select a method to show its results/);
    for (const filter of filters.slice(0, 5)) await React.act(async () => filter.click());
    assert.equal(rows().length, 5);
    assert.equal(tick(), range);
  } finally {
    await React.act(async () => root.unmount());
    await win.happyDOM.close();
    [globalThis.window, globalThis.document, globalThis.IS_REACT_ACT_ENVIRONMENT] = previous;
  }
});

test("all published editions render comparable measures and have Chinese and English evaluation notes", async () => {
  const { discoverResults } = await import("../scripts/prepare-data.mjs");
  const { fileURLToPath } = await import("node:url");
  const files = await discoverResults(fileURLToPath(new URL("../results", import.meta.url)), catalog);
  assert.ok(files.length >= 14);
  for (const { file } of files) {
    const snapshot = JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url)));
    const benchmark = resolveBenchmark(catalog, snapshot.benchmarks[0]);
    const html = render(benchmark, translator("zh", catalog, snapshot));
    assert.match(html, /方案对比/, file);
    assert.doesNotMatch(html, /NaN%|Infinity%/, file);
    assert.ok((html.match(/scope="col"/g) ?? []).length >= 3, file);
    for (const language of ["en", "zh"]) {
      const copy = historicalResultCopy(snapshot.id, language);
      if (!snapshot.release) assert.ok(copy?.scope && copy.notes.every(note => note.trim()), file);
    }
  }
});
