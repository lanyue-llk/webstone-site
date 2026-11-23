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

const versioning = await request("/versioning");
assert.equal(versioning.status, 200);
assert.match(versioning.headers.get("content-type"), /text\/html/);
assert.match(versioning.headers.get("cache-control"), /no-store/);

for (const path of ["/submit", "/submit/"]) {
  const redirect = await fetch(`${origin}${path}`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://github.com/lexmount/webstone-site#for-agents");
}
const release = await request("/release.json");
assert.equal(release.status, 200);
assert.match(release.headers.get("cache-control"), /no-store/);
assert.match((await release.json()).release, /^[a-f0-9]{64}$/);
console.log("Nginx entry, static assets, deep links, release and cache reset passed.");
