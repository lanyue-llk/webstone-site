import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

// Exercise the exported site through its real Nginx configuration in CI.
const origin = "http://127.0.0.1:8080";
const request = path => fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
let entry;
for (let attempt = 0; attempt < 20; attempt++) {
  try { entry = await request("/"); break; }
  catch (error) {
    if (attempt === 19) throw error;
    await setTimeout(250);
  }
}
assert.equal(entry.status, 200);
assert.match(entry.headers.get("content-type"), /text\/html/);
assert.match(entry.headers.get("cache-control"), /no-store/);
const html = await entry.text();
assert.match(html, /Webstone/);
assert.ok(html.includes("https://github.com/lexmount/webstone-site"), "Rendered GitHub link must target webstone-site");
assert.ok(!/github\.com\/lexmount\/browser-eval/i.test(html), "Retired GitHub destinations must not ship");
const stylesheet = /href="([^"?]+\.css)(?:\?[^"]*)?"/.exec(html)?.[1];
assert.ok(stylesheet, "The exported page must reference a stylesheet");
const asset = await request(stylesheet);
assert.equal(asset.status, 200);
assert.match(asset.headers.get("content-type"), /text\/css/);
assert.match(asset.headers.get("cache-control"), /max-age=31536000, immutable/);

const reset = await request("/cache-reset");
assert.equal(reset.status, 204);
assert.equal(reset.headers.get("clear-site-data"), '"cache"');
assert.match(reset.headers.get("cache-control"), /no-store/);
assert.equal(await reset.text(), "");

for (const path of ["/submit", "/versioning"]) {
  const page = await request(path);
  assert.equal(page.status, 200, path);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.headers.get("cache-control"), /no-store/);
  if (path === "/submit") {
    const guide = await page.text();
    assert.match(guide, /submit-webstone-result/);
    assert.ok(!guide.includes("Install the CLI"), "Results are submitted through a PR without a required Webstone install");
  }
}
const release = await request("/release.json");
assert.equal(release.status, 200);
assert.match(release.headers.get("cache-control"), /no-store/);
assert.match((await release.json()).release, /^[a-f0-9]{64}$/);
console.log("Nginx entry, static assets, deep links, release and cache reset passed.");
