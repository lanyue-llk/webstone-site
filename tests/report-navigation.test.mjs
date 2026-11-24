import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchReportBrowser,
  verifyReportNavigation,
} from "../scripts/report-browser.mjs";

let browser;
before(async () => {
  browser = await launchReportBrowser();
});
after(async () => {
  await browser?.close();
});
const share = "https://reports.example.org/artifact-site/s/public";
const preview =
  "https://reports.example.org/artifact-site/api/preview/public/index.html";
const manifest = "https://reports.example.org/manifest?file=index.html";
const entry = "https://cdn.example.org/index.html";
const html = (body, headers = {}) =>
  new Response(body, {
    headers: {
      "content-type": "text/html",
      "access-control-allow-origin": "*",
      ...headers,
    },
  });
const loader = `<script type="application/json" id="artifact-delivery-config">${JSON.stringify({ file: "index.html", manifestUrl: manifest })}</script><script>
(async()=>{
const config=JSON.parse(document.getElementById('artifact-delivery-config').textContent);
const manifest=await fetch(config.manifestUrl).then(response=>response.json());
const entry=manifest.files.find(file=>file.path===config.file);
const html=await fetch(entry.url).then(response=>response.text());
document.open();document.write(html);document.close();
})();
</script>`;
const delivery = { frames: [preview], entries: [entry] };
function fixture(overrides = {}) {
  return async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    if (Object.hasOwn(overrides, url)) return overrides[url]();
    if (url === share) return html(`<iframe src="${preview}"></iframe>`);
    if (url === preview) return html(loader);
    if (url === manifest)
      return Response.json({ files: [{ path: "index.html", url: entry }] });
    if (url === entry)
      return html(
        "<main><h1>Measured results</h1><p>Public report.</p></main>",
      );
    throw new Error("Unexpected fixture request");
  };
}
const check = (overrides = {}, extra = {}) =>
  verifyReportNavigation(browser, share, delivery, {
    resolve: async () => [{ address: "93.184.216.34" }],
    request: fixture(overrides),
    timeoutMs: 3000,
    ...extra,
  });

test("an anonymous browser executes the actual delivery loader", async () => {
  await check();
});

test("browser framing policy and sandbox restrictions block inaccessible previews", async () => {
  for (const headers of [
    { "x-frame-options": "DENY" },
    { "content-security-policy": "frame-ancestors 'none'" },
    { "content-security-policy": "frame-ancestors https://unrelated.example" },
  ])
    await assert.rejects(
      check({ [preview]: () => html(loader, headers) }),
      /Anonymous browser/,
    );
  for (const attributes of ["sandbox", 'sandbox="allow-same-origin"'])
    await assert.rejects(
      check({
        [share]: () => html(`<iframe ${attributes} src="${preview}"></iframe>`),
      }),
      /Anonymous browser/,
    );
});

test("parent header and meta CSP are enforced by the browser", async () => {
  for (const directive of ["frame-src", "child-src", "default-src"]) {
    await assert.rejects(
      check({
        [share]: () =>
          html(`<iframe src="${preview}"></iframe>`, {
            "content-security-policy": directive + " 'none'",
          }),
      }),
      /Anonymous browser/,
    );
  }
  await assert.rejects(
    check({
      [share]: () =>
        html(
          `<meta http-equiv="Content-Security-Policy" content="frame-src 'none'"><iframe src="${preview}"></iframe>`,
        ),
    }),
    /Anonymous browser/,
  );
});

test("attachment navigations fail while files fetched as data may be attachments", async () => {
  for (const url of [share, preview])
    await assert.rejects(
      check({
        [url]: () =>
          html(url === share ? `<iframe src="${preview}"></iframe>` : loader, {
            "content-disposition": "attachment",
          }),
      }),
      /Anonymous browser/,
    );
  await check({
    [entry]: () =>
      html("<main>Report</main>", { "content-disposition": "attachment" }),
  });
});

test("browser navigation never forwards credentials or reaches private destinations", async () => {
  let fetched = false;
  await assert.rejects(
    check(
      {},
      {
        resolve: async () => [{ address: "127.0.0.1" }],
        request: async () => {
          fetched = true;
          throw new Error("Must not request");
        },
      },
    ),
    /Anonymous browser/,
  );
  assert.equal(fetched, false);
});

test("a successful HTTP response still needs to be consumable by the loader", async () => {
  await assert.rejects(
    check({
      [entry]: () =>
        new Response("<main>Report</main>", {
          headers: { "content-type": "text/html" },
        }),
    }),
    /Anonymous browser/,
  );
  await assert.rejects(
    check({
      [preview]: () =>
        html(loader, { "content-security-policy": "script-src 'none'" }),
    }),
    /Anonymous browser/,
  );
});

test("the browser checks the full ancestor chain across a CDN iframe", async () => {
  const child = "https://cdn.example.org/child.html";
  const nested =
    "https://reports.example.org/artifact-site/api/preview/nested/index.html";
  const nestedManifest =
    "https://reports.example.org/nested-manifest?file=index.html";
  const nestedEntry = "https://cdn.example.org/nested.html";
  const graph = {
    frames: [preview, child, nested],
    entries: [entry, child, nestedEntry],
  };
  for (const [policy, allowed] of [
    ["frame-ancestors https://cdn.example.org", false],
    [
      "frame-ancestors https://cdn.example.org https://reports.example.org",
      true,
    ],
  ]) {
    const overrides = {
      [entry]: () => html(`<iframe src="${child}"></iframe>`),
      [child]: () => html(`<iframe src="${nested}"></iframe>`),
      [nested]: () =>
        html(loader.replaceAll(manifest, nestedManifest), {
          "content-security-policy": policy,
        }),
      [nestedManifest]: () =>
        Response.json({ files: [{ path: "index.html", url: nestedEntry }] }),
      [nestedEntry]: () => html("<main>Nested report</main>"),
    };
    const result = verifyReportNavigation(browser, share, graph, {
      resolve: async () => [{ address: "93.184.216.34" }],
      request: fixture(overrides),
      timeoutMs: 3000,
    });
    if (allowed) await result;
    else await assert.rejects(result, /Anonymous browser/);
  }
});
