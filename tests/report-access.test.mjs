import test from "node:test";
import assert from "node:assert/strict";
import { checkReportAccess, reportLinks } from "../scripts/check-report-access.mjs";

const address = "https://reports.example.org/report";
const html = body => new Response(body, { headers: { "content-type": "text/html" } });
const resolve = async () => [{ address: "93.184.216.34" }];
const check = (request, url = address) => checkReportAccess(url, { resolve, request });

test("report checks include catalog articles and result-specific reports once", () => {
  assert.deepEqual(reportLinks({ benchmarks: [{ reportUrl: address }] }, [{ id: "published", benchmarks: [{ reportUrl: address }, { reportUrl: address + "-v2" }, { reportUrl: null }] }], { reports: { published: { versionReport: true } } }), [address, address + "-v2"]);
});

test("an anonymous reader can open HTML and PDF reports without cookies or credentials", async () => {
  await check(async (_, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    return html("<h1>Web Search evaluation</h1><p>Results and methodology.</p>");
  });
  await check(async () => new Response("%PDF-1.7 content", { headers: { "content-type": "application/pdf" } }));
});

test("HTTP 200 sign-in pages, redirects, permission failures and empty reports fail", async () => {
  for (const response of [html("<h1>Access denied</h1><p>You are not signed in.</p>"), html('<meta name="description" content="Sign in to view this work">'), html('<input type="password">'), html(""), new Response("Forbidden", { status: 403 }), new Response(null, { status: 302, headers: { location: "/login" } })]) {
    await assert.rejects(check(async () => response));
  }
});

test("hosted report checks read the anonymous preview as well as the wrapper", async () => {
  const url = "https://reports.example.org/artifact-site/s/abc";
  const wrapper = '<iframe src="/artifact-site/api/preview/abc/?v=1&amp;r=0"></iframe>';
  const visited = [];
  await check(async target => { visited.push(target); return html(target === url ? wrapper : "<h1>Measured results</h1>"); }, url);
  assert.equal(visited[1], "https://reports.example.org/artifact-site/api/preview/abc/?v=1&r=0");
  await assert.rejects(check(async target => target === url ? html(wrapper) : new Response("Forbidden", { status: 403 }), url), /403/);
  await assert.rejects(check(async () => html("<h1>Report</h1>"), url), /no readable preview/);
});

test("redirects cannot turn a report check into a private-network request", async () => {
  await assert.rejects(check(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })), /public HTTPS/);
  for (const privateAddress of ["10.2.62.142", "127.0.0.1", "169.254.169.254", "::1", "fd00::1"]) {
    await assert.rejects(checkReportAccess(address, { resolve: async () => [{ address: privateAddress }], request: () => { throw new Error("Must not be called"); } }), /private or reserved/);
  }
});

test("withdrawn reports are excluded while both published language links are checked", () => {
  assert.deepEqual(reportLinks({ benchmarks: [{ reportUrl: address }] }, [{ id: "withdrawn", benchmarks: [{ reportUrl: address + "/private" }] }],
    { reports: { published: { urls: { zh: address + "/zh", en: address + "/en" } } } }), [address, address + "/zh", address + "/en"]);
});

test("delivery loading shells require a readable anonymous manifest and entry file", async () => {
  const url = "https://reports.example.org/artifact-site/s/abc";
  const preview = 'https://reports.example.org/preview';
  const manifest = 'https://reports.example.org/delivery?__manifest=1';
  const entry = 'https://cdn.example.org/report.html';
  const request = async target => {
    if (target === url) return html('<iframe src="/preview"></iframe>');
    if (target === preview) return html('<script id="artifact-delivery-config" type="application/json">'+JSON.stringify({manifestUrl:manifest,file:'index.html'})+'</script>');
    if (target.startsWith(manifest)) return Response.json({files:[{path:'index.html',url:entry}],nextCursor:null});
    if (target === entry) return new Response("Forbidden", {status:403});
    throw Error('Unexpected target');
  };
  await assert.rejects(check(request,url), /403/);
  await check(async target => target === entry ? html('<h1>Measured results</h1>') : request(target),url);
});

test("a readable report can discuss authentication failures without becoming a sign-in page", async () => {
  await check(async () => html('<h1>Web tool evaluation</h1><p>'+('Measured results and methodology. '.repeat(200))+'需要登录的页面也能访问。</p>'));
});
