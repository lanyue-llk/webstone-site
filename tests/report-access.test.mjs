import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { discoverResults } from "../scripts/prepare-data.mjs";
import { readFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";
import { anonymousRequest, checkReportAccess, reportDocument, reportLinks, validatePublication } from "../scripts/check-report-access.mjs";

const body = "<main><h1>Measured results</h1><p>Results and methodology.</p></main>";
const digest = text => createHash("sha256").update(text).digest("hex");
const html = content => new Response(content, { headers: { "content-type": "text/html; charset=utf-8" } });
const resolve = async () => [{ address: "93.184.216.34" }];
function fixture(slug = "abc", content = body) {
  const share = `https://reports.example.org/artifact-site/s/${slug}`;
  const preview = `https://reports.example.org/artifact-site/api/preview/${slug}/index.html`;
  const manifest = `https://reports.example.org/${slug}-manifest?file=index.html`;
  const entry = `https://cdn.example.org/${slug}.html`;
  const publication = { versionId: "ver_approved", entry: { path: "index.html", sha256: digest(content) } };
  const loader = `<script id="artifact-delivery-config">${JSON.stringify({ manifestUrl: manifest, file: "index.html" })}</script>`;
  function request(overrides = {}) {
    return async (url, options) => {
      assert.equal(options.credentials, "omit"); assert.equal(options.headers, undefined);
      if (Object.hasOwn(overrides, url)) return overrides[url]();
      if (url === share) return html(`<header>Optional account controls</header><iframe src="${preview}"></iframe>`);
      if (url === preview) return html(loader);
      if (url === manifest) return Response.json({ versionId: publication.versionId, files: [{ path: "index.html", url: entry }], nextCursor: null });
      if (url === entry) return html(content);
      throw Error("Unexpected request: " + url);
    };
  }
  return { share, preview, manifest, entry, publication, loader, request };
}
const sample = fixture();
const check = (request = sample.request(), extra = {}) => checkReportAccess(sample.share, { publication: sample.publication, resolve, request, ...extra });

// Rendering is reviewed by the publisher. CI proves that the same immutable
// publication and original bytes remain anonymously available.
test("anonymous delivery matches the reviewed publication and original report bytes", async () => {
  const visited = [], request = sample.request();
  await check(async (url, options) => { visited.push(url); return request(url, options); });
  assert.deepEqual(visited, [sample.share, sample.preview, sample.manifest, sample.entry]);
});

test("both language destinations have reviewed publications and withdrawn links are excluded", async () => {
  assert.deepEqual(reportLinks({ benchmarks: [{ reportUrl: sample.share }] }, [{ id: "withdrawn", benchmarks: [{ reportUrl: sample.share + "-private" }] }], { reports: { current: { urls: { en: sample.share + "-en", zh: sample.share } } } }), [sample.share, sample.share + "-en"]);
  const catalog = JSON.parse(await readFile(new URL("../benchmarks/catalog.json", import.meta.url)));
  const metadata = JSON.parse(await readFile(new URL("../reports/metadata.json", import.meta.url)));
  const publications = JSON.parse(await readFile(new URL("../reports/publications.json", import.meta.url)));
  const files = await discoverResults(fileURLToPath(new URL("../results/", import.meta.url)), catalog);
  for (const url of reportLinks(catalog, files.map(file => file.report), metadata)) validatePublication(publications[url]);
});

test("unknown or malformed approvals fail before any network request", async () => {
  for (const publication of [null, {}, { ...sample.publication, versionId: "latest" }, { ...sample.publication, entry: { path: "../index.html", sha256: digest(body) } }, { ...sample.publication, entry: { path: "index.html", sha256: "invalid" } }]) await assert.rejects(check(undefined, { publication, request: () => { throw Error("Must not fetch"); } }), /reviewed|Reviewed|Unsafe/);
  const cyclic = structuredClone(sample.publication); cyclic.url = sample.share; cyclic.dependencies = [cyclic];
  assert.throws(() => validatePublication(cyclic), /cyclic/);
});

test("private, missing and changed report publications block release", async () => {
  for (const url of [sample.share, sample.preview, sample.manifest, sample.entry]) await assert.rejects(check(sample.request({ [url]: () => new Response("Forbidden", { status: 403 }) })), /403/);
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ versionId: "ver_new", files: [], nextCursor: null }) })), /publication changed/);
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ versionId: sample.publication.versionId, files: [], nextCursor: null }) })), /entry is missing/);
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ versionId: sample.publication.versionId, files: null }) })), /Invalid report delivery/);
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ versionId: sample.publication.versionId, files: [], nextCursor: 100 }), [sample.manifest + "&cursor=100"]: () => Response.json({ versionId: "ver_new", files: [{ path: "index.html", url: sample.entry }] }) })), /publication changed/);
});

test("login pages, hidden overlays and any replacement content fail the reviewed-byte check", async () => {
  for (const content of ["<h1>Sign in</h1>", '<main>Please sign in to view this report.</main>', '<h1>Access denied</h1><p>You do not have permission.</p>', '<form><input type="password"></form><footer>Copyright 2026</footer>', '<style>main{display:none}</style>' + body, body + "<dialog open>Password required</dialog>"]) await assert.rejects(check(sample.request({ [sample.entry]: () => html(content) })), /entry has changed/);
});

test("reviewed public reports may contain optional account controls or media widgets", async () => {
  const content = '<aside><form><input type="password"></form></aside>' + body + '<iframe src="about:blank"></iframe>';
  const publicReport = fixture("with-widgets", content);
  await checkReportAccess(publicReport.share, { publication: publicReport.publication, resolve, request: publicReport.request() });
});

test("required report dependencies stay anonymous and match their reviewed versions", async () => {
  const dependency = fixture("dependency", "<main><h1>Independent English report</h1><p>Its own results.</p></main>");
  dependency.publication.versionId = "ver_dependency";
  const publication = { ...sample.publication, dependencies: [{ url: dependency.share, ...dependency.publication }] };
  const request = async (url, options) => url.includes("dependency") ? dependency.request()(url, options) : sample.request()(url, options);
  await check(request, { publication });
  await assert.rejects(check(async (url, options) => url === dependency.entry ? new Response("Forbidden", { status: 403 }) : request(url, options), { publication }), /403/);
  await assert.rejects(check(async (url, options) => url === dependency.manifest ? Response.json({ versionId: "ver_new", files: [] }) : request(url, options), { publication }), /publication changed/);
});

test("language entries select the reviewed file within the public report", async () => {
  const publication = { ...sample.publication, entry: { ...sample.publication.entry, path: "en/index.html" } };
  const preview = sample.preview.replace("index.html", "en/index.html");
  const manifest = sample.manifest.replace("index.html", "en%2Findex.html");
  const request = sample.request({ [preview]: () => html(`<script id="artifact-delivery-config">${JSON.stringify({ manifestUrl: sample.manifest, file: "en/index.html" })}</script>`), [manifest]: () => Response.json({ versionId: publication.versionId, files: [{ path: "en/index.html", url: sample.entry }], nextCursor: null }) });
  await check(request, { publication });
});

test("share wrappers must expose the report service preview and may not add unreviewed required embeds", async () => {
  for (const content of ['<h1>Sign in</h1>', '<svg><iframe src="' + sample.preview + '"></iframe></svg>', '<iframe src="https://other.example.org/artifact-site/api/preview/abc/"></iframe>']) await assert.rejects(check(sample.request({ [sample.share]: () => html(content) })), /no report-service preview/);
  await assert.rejects(check(sample.request({ [sample.preview]: () => html("<h1>Sign in</h1>") })), /reviewed report entry/);
  await assert.rejects(check(sample.request({ [sample.share]: () => html(`<iframe src="${sample.preview}"></iframe><iframe data-report-preview src="/private"></iframe>`) })), /unreviewed required preview/);
});

test("redirects remain public and stop before requesting sign-in destinations", async () => {
  const start = "https://reports.example.org/old-report", visited = [], request = sample.request();
  await checkReportAccess(start, { publication: sample.publication, resolve, request: async (url, options) => { visited.push(url); return url === start ? new Response(null, { status: 302, headers: { location: sample.share } }) : request(url, options); } });
  assert.equal(visited[1], sample.share);
  const blocked = [];
  await assert.rejects(check(async url => { blocked.push(url); return new Response(null, { status: 302, headers: { location: "/login" } }); }), /sign-in/);
  assert.deepEqual(blocked, [sample.share]);
});

test("all DNS answers and every secondary destination are validated before requesting", async () => {
  for (const target of [sample.share, sample.preview, sample.manifest, sample.entry]) {
    const visited = []; let current;
    const request = sample.request();
    await assert.rejects(check(async (url, options) => { visited.push(url); return request(url, options); }, { resolve: async () => { current = [sample.share, sample.preview, sample.manifest, sample.entry][visited.length]; return current === target ? [{ address: "93.184.216.34" }, { address: "10.0.0.1" }] : resolve(); } }), /private or reserved/);
    assert.ok(!visited.includes(target));
  }
  for (const address of ["127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "240.0.0.1", "ff02::1", "fec0::1", "192.0.2.1", "2001:db8::1"]) await assert.rejects(check(undefined, { resolve: async () => [{ address }], request: () => { throw Error("Must not fetch"); } }), /private or reserved/);
});

test("HTTPS uses each host's pinned DNS records and never adds authentication", async () => {
  const pinned = (_host, options, callback) => callback(null, options.all ? [{ address: "93.184.216.34", family: 4 }] : "93.184.216.34", 4);
  const transport = (_url, options, callback) => {
    assert.equal(options.lookup, pinned); assert.equal(options.auth, undefined); assert.equal(options.headers, undefined);
    const req = new EventEmitter(); req.end = () => { const response = Readable.from([Buffer.from(body)]); response.statusCode = 200; response.headers = { "content-type": "text/html" }; callback(response); }; return req;
  };
  assert.equal(await (await anonymousRequest(sample.entry, { lookup: pinned }, transport)).text(), body);
  const addresses = { "reports.example.org": "93.184.216.34", "cdn.example.org": "8.8.8.8" }, request = sample.request();
  await check(async (url, options) => { const host = new URL(url).hostname; const records = await new Promise((resolve, reject) => options.lookup(host, { all: true }, (error, value) => error ? reject(error) : resolve(value))); assert.deepEqual(records, [{ address: addresses[host], family: 4 }]); return request(url, options); }, { resolve: async host => [{ address: addresses[host] }] });
});

test("DNS and report dependency checks have finite time and request budgets", async () => {
  await assert.rejects(check(undefined, { timeoutMs: 20, resolve: () => new Promise(() => {}), request: () => { throw Error("Must not fetch"); } }), /time budget/);
  const publication = { ...sample.publication, dependencies: Array.from({ length: 12 }, () => ({ url: sample.share, ...sample.publication })) };
  await assert.rejects(check(undefined, { publication }), /budget/);
});

test("HTML metadata uses browser namespaces, quoted UTF-8 declarations and bounded parsing", async () => {
  await assert.rejects(check(sample.request({ [sample.share]: () => html('<meta hidden http-equiv="refresh" content="0;url=/login"><iframe src="' + sample.preview + '"></iframe>') })), /refresh/);
  const metadata = await reportDocument('<svg><script id="artifact-delivery-config">{}</script><base href="https://invalid.example.org/"></base></svg><meta http-equiv="Content-Type" content=\'text/html; charset="UTF-8"\'>');
  assert.equal(metadata.deliveryConfig, null); assert.equal(metadata.baseHref, null); assert.equal(metadata.charset, "UTF-8");
  for (const content of ['<i></i>'.repeat(500000), '<div>'.repeat(300) + body + '</div>'.repeat(300)]) await assert.rejects(reportDocument(content), /complexity/);
  await assert.rejects(check(sample.request({ [sample.preview]: () => new Response("Report", { headers: { "content-type": "text/html; charset=GB18030" } }) })), /UTF-8/);
  await assert.rejects(check(sample.request({ [sample.preview]: () => new Response(Buffer.from([0xff, 0xfe]), { headers: { "content-type": "text/html" } }) })), error => error.code === "ERR_ENCODING_INVALID_ENCODED_DATA");
});

function transportResponse(bytes, headers, status = 200) {
  return (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = error => { if (error) req.emit("error", error); };
    req.end = () => queueMicrotask(() => { const response = Readable.from([bytes]); response.statusCode = status; response.headers = headers; callback(response); }); return req;
  };
}


test("compressed bodies are decoded and corrupt or unsupported encodings fail safely", async () => {
  for (const [encoding, compress] of [["gzip", gzipSync], ["br", brotliCompressSync], ["deflate", deflateSync]]) {
    assert.equal(await (await anonymousRequest(sample.entry, {}, transportResponse(compress(Buffer.from(body)), { "content-type": "text/html", "content-encoding": encoding }))).text(), body);
    assert.deepEqual(await (await anonymousRequest(sample.entry, {}, transportResponse(compress(Buffer.from('{"files":[]}')), { "content-type": "application/json", "content-encoding": encoding }))).json(), { files: [] });
    for (const bytes of [Buffer.from("invalid compressed bytes"), compress(Buffer.from(body.repeat(20))).subarray(0, 4)]) await assert.rejects(anonymousRequest(sample.entry, {}, transportResponse(bytes, { "content-encoding": encoding })), error => /^(?:Z_(?:DATA|BUF)_ERROR|ERR_(?:_ERROR_FORMAT_)?PADDING_1)$/.test(error.code ?? ""));
  }
  for (const encoding of ["constructor", "__proto__", "unknown"]) await assert.rejects(anonymousRequest(sample.entry, {}, transportResponse(Buffer.from(body), { "content-encoding": encoding })), /Unsupported/);
  await assert.rejects(anonymousRequest(sample.entry, {}, transportResponse(gzipSync(Buffer.alloc(21 * 1024 * 1024, 65)), { "content-encoding": "gzip" })), /20 MiB/);
});

test("redirect bodies are discarded before decoding and empty responses do not crash", async () => {
  for (const encoding of ["unsupported", "gzip"]) {
    const response = await anonymousRequest(sample.entry, {}, transportResponse(Buffer.from("unused"), { location: sample.share, "content-encoding": encoding, "content-length": "999999999" }, 302));
    assert.equal(response.status, 302); assert.equal(response.headers.get("location"), sample.share);
  }
  for (const status of [204, 205, 304]) assert.equal((await anonymousRequest(sample.entry, {}, transportResponse(Buffer.alloc(0), {}, status))).status, status);
});

test("HTTPS cancellation bounds stalled headers and bodies and closes transport resources", {timeout:2000}, async () => {
  for(const stage of ["headers","body"]) {
    const controller = new AbortController();
    let req,response,guard;
    const transport=(_url,options,callback)=>{
      req=new EventEmitter();req.destroyed=false;
      req.destroy=error=>{req.destroyed=true;response?.destroy(error);req.emit("error",error);};
      guard=setTimeout(()=>req.destroy(new Error("Independent test guard expired")),500);
      assert.equal(options.signal, controller.signal);
      options.signal.addEventListener("abort",()=>req.destroy(options.signal.reason),{once:true});
      req.end=()=>{if(stage==="body"){response=new Readable({read(){}});response.statusCode=200;response.headers={"content-type":"text/html"};callback(response);} queueMicrotask(()=>controller.abort());};
      return req;
    };
    try {
      await assert.rejects(anonymousRequest(sample.entry,{signal:controller.signal},transport), error=>error.name==="TimeoutError" || error.name==="AbortError");
      assert.equal(req.destroyed,true);
      if(response)assert.equal(response.destroyed,true);
    } finally {clearTimeout(guard);}
  }
});


test("decoder failure closes a corrupt response before a server ends its stream", {timeout:1000}, async () => {
  let req,response;
  const transport=(_url,_options,callback)=>{
    req=new EventEmitter();req.destroyed=false;req.destroy=error=>{req.destroyed=true;if(error)req.emit("error",error);};
    req.end=()=>{response=new Readable({read(){}});response.headers={"content-encoding":"gzip"};response.statusCode=200;callback(response);response.push(Buffer.from("invalid compressed bytes"));};return req;
  };
  await assert.rejects(anonymousRequest(sample.entry,{},transport), error=>error.code==="Z_DATA_ERROR");
  assert.equal(req.destroyed,true);assert.equal(response.destroyed,true);
});


test("checker deadlines cancel both stalled HTTPS stages", {timeout:6000}, async () => {
  for(const stage of ["headers","body"]) {
    let req,response,guard;
    const transport=(_url,options,callback)=>{
      req=new EventEmitter();req.destroyed=false;
      req.destroy=error=>{req.destroyed=true;response?.destroy(error);req.emit("error",error);};
      guard=setTimeout(()=>req.destroy(new Error("Independent test guard expired")),2000);
      assert.ok(options.signal instanceof AbortSignal);
      options.signal.addEventListener("abort",()=>req.destroy(options.signal.reason),{once:true});
      req.end=()=>{if(stage==="body"){response=new Readable({read(){}});response.statusCode=200;response.headers={"content-type":"text/html"};callback(response);}};
      return req;
    };
    try {
      await assert.rejects(checkReportAccess(sample.share,{publication:sample.publication,resolve,timeoutMs:1000,request:(url,options)=>anonymousRequest(url,options,transport)}),error=>error.name==="TimeoutError" || error.name==="AbortError");
      assert.equal(req?.destroyed,true);if(response)assert.equal(response.destroyed,true);
    } finally {clearTimeout(guard);}
  }
});
