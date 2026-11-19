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
    provider("Known cost missing quality", { accuracy: null, precision: .6, recall: .6, p50: 40 }, { min: 1000, max: 1000, description: "Per 1K calls" }),
  ],
};
const render = (t, data = benchmark) => renderToStaticMarkup(React.createElement(Insights, { benchmark: data, t }));

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
  const costPlot = html.match(/<svg[^>]*aria-label="accuracy \/ Quoted price \/ 1K"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  assert.ok(costPlot);
  assert.match(costPlot, /class="point-number"[^>]*>2<\/text>/);
  assert.match(html, /Cost unavailable.*Missing profile/);
  assert.doesNotMatch(html, /Cost unavailable[^<]*Known cost missing quality/);
  assert.match(html, /Quality unavailable.*Known cost missing quality/);
  const chinese = render(translator("zh"));
  assert.match(chinese, /每千次报价/);
  assert.doesNotMatch(chinese, /Quoted price \/ 1K/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("one primary bubble plot shows latency, quality and bounded or unknown cost together", () => {
  const html = render(text => text);
  const bubble = html.match(/<svg[^>]*aria-label="accuracy \/ P50 latency"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  assert.ok(bubble);
  const outer = Number(bubble.match(/<circle[^>]*r="([^"]+)"[^>]*aria-label="Ranged quote[^>]*>/)?.[1]);
  const inner = Number(bubble.match(/<circle[^>]*r="([^"]+)"[^>]*stroke-dasharray="2 2"/)?.[1]);
  const zero = Number(bubble.match(/<circle[^>]*r="([^"]+)"[^>]*aria-label="Zero quote[^>]*>/)?.[1]);
  assert.ok(outer > inner && inner > zero);
  assert.ok(outer > 20 && outer < 21, "a $1,000 method missing accuracy cannot shrink the plotted $2–$7 range");
  assert.equal(zero, 4);
  assert.match(bubble, /stroke-dasharray="2 2"/);
  assert.match(bubble, /fill="white"[^>]*aria-label="Missing profile/);
  assert.match(html, /Bubble size represents reported cost/);
});

test("signed resource deltas stay inside the plot instead of being clipped below zero", () => {
  const data = { ...benchmark, metrics: [...metrics.slice(0, 3), { id: "delta", label: "Memory delta", unit: "mib", signed: true, direction: "asc" }],
    providers: benchmark.providers.slice(0, 3).map((provider, index) => ({ ...provider, scores: { ...provider.scores, delta: index - 1 } })),
  };
  const plot = render(text => text, data).match(/<svg[^>]*aria-label="accuracy \/ Memory delta"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  assert.ok(plot);
  const markers = [...plot.matchAll(/<circle[^>]*cx="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>/g)];
  assert.equal(markers.length, 3);
  for (const provider of data.providers) assert.ok(markers.some(marker => marker[2].startsWith(`${provider.name} ·`)), provider.name);
  const negative = markers.find(marker => marker[2].startsWith("Missing profile ·"));
  assert.ok(negative);
  assert.equal(Number(negative[1]), 60);
  for (const marker of markers) assert.ok(Number(marker[1]) >= 60 && Number(marker[1]) <= 420);
});

test("a sparse selected axis retains the selector so another metric remains reachable", () => {
  const data = { ...benchmark, metrics: [...metrics, { id: "other", label: "Other latency", unit: "ms", direction: "asc" }],
    providers: benchmark.providers.map((provider, index) => ({ ...provider, scores: { ...provider.scores, p50: index === 1 ? 10 : null, other: index + 1 } })),
  };
  const card = render(text => text, data).match(/<article class="insight-card scatter-card">([\s\S]*?)<\/article>/)?.[1];
  assert.ok(card);
  assert.match(card, /At least two methods with both axis values/);
  assert.match(card, /<select aria-label="Horizontal axis"/);
  assert.match(card, /<option value="other">Other latency<\/option>/);
});

test("sub-cent quotes use their own axis range and retain readable price labels", () => {
  const data = { ...benchmark, providers: benchmark.providers.map(provider => {
    if (provider.id !== "Ranged quote") return provider;
    return { ...provider, pricing: { min: .002, max: .007, description: "Per 1K calls" } };
  }) };
  const plot = render(text => text, data).match(/<svg[^>]*aria-label="accuracy \/ Quoted price \/ 1K"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  assert.ok(plot);
  const x = Number(plot.match(/<circle[^>]*cx="([^"]+)"[^>]*aria-label="Ranged quote/)?.[1]);
  assert.ok(x > 100 && x <= 420);
  assert.match(plot, /\$0\.002–\$0\.007/);
});

for (const paired of [0, 1]) test(`cost comparison with ${paired} eligible pairs explains missing measurements`, () => {
  const data = { ...benchmark, providers: benchmark.providers.map((provider, index) => ({
    ...provider, scores: { ...provider.scores, accuracy: index === 1 && paired === 1 ? .8 : null },
  })) };
  const html = render(text => text, data);
  const costDetails = html.split("<summary>Accuracy and cost</summary>")[1]?.split("</details>")[0];
  assert.ok(costDetails);
  assert.match(costDetails, /At least two methods with both axis values/);
  assert.match(costDetails, /Cost unavailable.*Missing profile/);
  assert.match(costDetails, /Quality unavailable.*Known cost missing quality/);
  assert.doesNotMatch(costDetails, /<svg|NaN|Infinity/);
});

test("latency charts leave visibly incompatible quotes out of bubble sizing", () => {
  const data = {
    ...benchmark,
    metrics: [...metrics, { id: "price", label: "Price / 1K", unit: "usd", direction: "asc", highlightBest: false }],
    providers: benchmark.providers.map((row, index) => ({ ...row, pricing: undefined, scores: { ...row.scores, price: index } })),
  };
  const html = render(text => text, data);
  assert.match(html, /<h3>Accuracy and latency<\/h3>/);
  assert.doesNotMatch(html, /Bubble size represents reported cost/);
  assert.match(html, /<summary>Accuracy and cost<\/summary>/);
  assert.match(html, /quotes with different billing units/);
});

test("a report without cost figures still compares quality and latency", () => {
  const data = { ...benchmark, providers: benchmark.providers.map(row => ({ ...row, pricing: undefined })) };
  const html = render(text => text, data);
  assert.match(html, /<h3>Accuracy and latency<\/h3>/);
  assert.match(html, /aria-label="accuracy \/ P50 latency"/);
  assert.doesNotMatch(html, /Bubble size represents reported cost|<summary>Accuracy and cost<\/summary>/);
});
