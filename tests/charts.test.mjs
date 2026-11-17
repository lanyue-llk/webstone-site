import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

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

const metrics = [
  ...["accuracy", "precision", "recall"].map(id => ({ id, label: id, unit: "ratio", direction: "desc" })),
  { id: "p50", label: "P50 latency", unit: "ms", direction: "asc" },
];
const provider = (id, scores, pricing) => ({ id, name: id, description: id, mode: "Not specified", passed: null, scores, pricing });
const benchmark = {
  id: "fixture", name: "Fixture", primaryMetric: "accuracy", metrics, categories: [], taskCount: 10,
  providers: [
    provider("Missing profile", { accuracy: .9, precision: .8, recall: null, p50: 10 }, { min: null, max: null, softwareCost: 0, description: "Model billed separately" }),
    provider("Ranged quote", { accuracy: .8, precision: .8, recall: .8, p50: 20 }, { min: 2, max: 7, description: "Per 1K calls" }),
    provider("Zero quote", { accuracy: .7, precision: .7, recall: .7, p50: 30 }, { min: 0, max: 0, description: "No charge" }),
  ],
};
const render = t => renderToStaticMarkup(React.createElement(Insights, { benchmark, t }));

test("a missing radar axis does not reassign another selected method's color", () => {
  const html = render(text => text);
  const radar = html.match(/<svg[^>]*aria-label="Capability profile"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  assert.ok(radar);
  assert.match(radar, /style="color:#5869b0"/);
  assert.match(radar, /style="color:#bc7540"/);
  assert.doesNotMatch(radar, /style="color:#28745b"/);
  assert.match(html, /Profile data unavailable.*Missing profile/);
});

test("cost rendering preserves ranges, zero and unknown totals, including Chinese labels", () => {
  const html = render(text => text);
  assert.match(html, /Ranged quote · Quoted price \/ 1K: \$2(?:\.0+)?–\$7/);
  assert.doesNotMatch(html, /\$4\.5/);
  assert.match(html, /Zero quote · Quoted price \/ 1K: \$0/);
  assert.match(html, /Cost unavailable.*Missing profile/);
  const chinese = render(translator("zh"));
  assert.match(chinese, /每千次报价/);
  assert.doesNotMatch(chinese, /Quoted price \/ 1K/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
