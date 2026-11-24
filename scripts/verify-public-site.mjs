import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const origin = process.env.SITE_ORIGIN;
assert.ok(origin && /^https?:\/\//.test(origin), "SITE_ORIGIN must identify the deployed site");
const expected = JSON.parse(await readFile(new URL("../web/public/release.json", import.meta.url), "utf8"));
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { cache: "no-store", signal: AbortSignal.timeout(20000), ...options });
}
let matched = false;
let lastFailure = "release identifier differs";
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await request(`/release.json?check=${Date.now()}`);
    if (response.ok && (await response.json()).release === expected.release) { matched = true; break; }
    lastFailure = `HTTP ${response.status}: release identifier differs`;
  } catch (error) { lastFailure = error.message; }
  await setTimeout(5000);
}
assert.ok(matched, `Public release does not match the built source: ${lastFailure}`);
const entry = await request("/");
assert.equal(entry.status, 200);
assert.match(entry.headers.get("cache-control") ?? "", /no-store/);
const html = await entry.text();
assert.match(html, /Webstone/);
const stylesheet = /href="([^"?]+\.css)(?:\?[^"]*)?"/.exec(html)?.[1];
assert.ok(stylesheet);
const asset = await request(stylesheet);
assert.equal(asset.status, 200);
assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
const catalog = await (await request("/benchmarks/catalog.json")).json();
const localCatalog = JSON.parse(await readFile(new URL("../web/public/benchmarks/catalog.json", import.meta.url), "utf8"));
assert.deepEqual(catalog, localCatalog);
const reportsResponse = await request("/results/reports.json");
assert.equal(reportsResponse.status, 200);
assert.match(reportsResponse.headers.get("cache-control") ?? "", /no-store/);
const reports = await reportsResponse.json();
const localReports = JSON.parse(await readFile(new URL("../web/public/results/reports.json", import.meta.url), "utf8"));
assert.deepEqual(reports, localReports, "Published result index must match the built index");
await Promise.all(localReports.map(async ({ file, report }) => {
  const response = await request(`/results/${file}`);
  assert.equal(response.status, 200, file);
  assert.deepEqual(await response.json(), report, file);
}));
const redirect = await request("/submit", { redirect: "manual" });
assert.equal(redirect.status, 302);
const redirects = await readFile(new URL("../web/public/_redirects", import.meta.url), "utf8");
assert.equal(redirect.headers.get("location"), redirects.split("\n").find(line => line.startsWith("/submit ")).trim().split(/\s+/)[1]);
const reset = await request("/cache-reset");
assert.ok([200, 204].includes(reset.status));
assert.equal(reset.headers.get("clear-site-data"), '"cache"');
console.log(`Verified ${reports.length} downloadable result editions, public navigation, cache headers and release ${expected.release}.`);
