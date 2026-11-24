import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";
import { anonymousRequest, checkReportAccess, reportDocument, reportLinks } from "../scripts/check-report-access.mjs";

const share = "https://reports.example.org/artifact-site/s/abc";
const preview = "https://reports.example.org/artifact-site/api/preview/abc/";
const manifest = "https://reports.example.org/manifest?file=index.html";
const entry = "https://cdn.example.org/report.html";
const html = body => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const resolve = async () => [{ address: "93.184.216.34" }];
const body = "<main><h1>Measured results</h1><p>Results and methodology.</p></main>";
const loader = '<script id="artifact-delivery-config">{"manifestUrl":"https://reports.example.org/manifest","file":"index.html"}</script>';
function publication(overrides = {}, content = body) {
  return async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    if (Object.hasOwn(overrides, url)) return overrides[url]();
    if (url === share) return html('<iframe src="/artifact-site/api/preview/abc/"></iframe>');
    if (url === preview) return html(loader);
    if (url === manifest) return Response.json({ files: [{ path: "index.html", url: entry }], nextCursor: null });
    if (url === entry) return html(content);
    throw Error("Unexpected request: " + url);
  };
}
const check = request => checkReportAccess(share, { resolve, request });

// Access is proved through the publication service's anonymous delivery protocol.
// Report producers own browser rendering and evidence/presentation checks.
test("public shares expose their original report without cookies or credentials", async () => {
  const visited = [];
  const request = publication();
  await check(async (url, options) => { visited.push(url); return request(url, options); });
  assert.deepEqual(visited, [share, preview, manifest, entry]);
});

test("both language destinations are checked, withdrawn result links are excluded", () => {
  const en = share + "-en";
  assert.deepEqual(reportLinks({ benchmarks: [{ reportUrl: share }] }, [{ id: "withdrawn", benchmarks: [{ reportUrl: share + "-private" }] }],
    { reports: { published: { urls: { en, zh: share } } } }), [share, en]);
});

test("a title or sign-in wrapper cannot stand in for a public report preview", async () => {
  for (const content of ["<h1>Sign in</h1>", body, '<main><p>Please <a href="/login">sign in</a> to view this report.</p></main>']) {
    await assert.rejects(check(publication({ [share]: () => html(content) })), /no report-service preview|authentication/);
  }
  await assert.rejects(check(publication({ [preview]: () => html("<h1>Sign in</h1>") })), /delivery manifest|authentication/);
});

test("permission failures at every publication boundary block release", async () => {
  for (const url of [share, preview, manifest, entry]) {
    await assert.rejects(check(publication({ [url]: () => new Response("Forbidden", { status: 403 }) })), /403/);
  }
  await assert.rejects(check(publication({ [manifest]: () => Response.json({ files: [], nextCursor: null }) })), /entry is missing/);
});

test("optional account controls and media embeds do not change public sharing permissions", async () => {
  await check(publication({}, '<header><form><input type="password"></form></header>' + body + '<iframe src="about:blank"></iframe>'));
  await assert.rejects(check(publication({ "https://reports.example.org/private": () => new Response("Forbidden", { status: 403 }) }, body + '<iframe data-report-preview src="https://reports.example.org/private"></iframe>')), /403/);
});

test("a language-only entry follows its required report-service preview", async () => {
  const nested = "https://reports.example.org/artifact-site/api/preview/translated/en/index.html";
  await check(publication({
    [nested]: () => html('<script id="artifact-delivery-config">{"manifestUrl":"https://reports.example.org/english-manifest","file":"en/index.html"}</script>'),
    "https://reports.example.org/english-manifest?file=en%2Findex.html": () => Response.json({ files: [{ path: "en/index.html", url: "https://cdn.example.org/english.html" }], nextCursor: null }),
    "https://cdn.example.org/english.html": () => html(body),
  }, '<iframe src="' + nested + '"></iframe>'));
  await assert.rejects(check(publication({ [nested]: () => html("<h1>Sign in</h1>") }, '<iframe src="' + nested + '"></iframe>')), /delivery manifest|authentication/);
});

test("delivery metadata and explicitly required embedded reports are both verified", async () => {
  await assert.rejects(check(publication({ [preview]: () => html(loader + '<iframe data-report-preview src="https://reports.example.org/private"></iframe>'), "https://reports.example.org/private": () => new Response("Forbidden", { status: 403 }) })), /403/);
});

test("redirects follow public shares and stop before requesting a sign-in page", async () => {
  const start = "https://reports.example.org/old-report";
  const visited = [];
  const request = publication();
  await checkReportAccess(start, { resolve, request: async (url, options) => { visited.push(url); return url === start ? new Response(null, { status: 302, headers: { location: share } }) : request(url, options); } });
  assert.deepEqual(visited, [start, share, preview, manifest, entry]);
  const blocked = [];
  await assert.rejects(checkReportAccess(start, { resolve, request: async url => { blocked.push(url); return new Response(null, { status: 302, headers: { location: "/login" } }); } }), /sign-in/);
  assert.deepEqual(blocked, [start]);
});

test("each secondary destination and every DNS answer is validated before requests", async () => {
  for (const location of ["redirect", "manifest", "entry", "required-frame"]) {
    const privateUrl = "https://private.example.org/report";
    const request = publication({
      
      ...(location === "manifest" ? { [preview]: () => html('<script id="artifact-delivery-config">{"manifestUrl":"' + privateUrl + '","file":"index.html"}</script>') } : {}),
      ...(location === "entry" ? { [manifest]: () => Response.json({ files: [{ path: "index.html", url: privateUrl }], nextCursor: null }) } : {}),
      ...(location === "redirect" ? { [share]: () => new Response(null, { status: 302, headers: { location: privateUrl } }) } : {}),
    }, location === "required-frame" ? body + '<iframe data-report-preview src="' + privateUrl + '"></iframe>' : body);
    const visited = [];
    await assert.rejects(checkReportAccess(share, { resolve: async host => host === "private.example.org" ? [{ address: "93.184.216.34" }, { address: "10.0.0.1" }] : resolve(), request: async (url, options) => { visited.push(url); return request(url, options); } }), /private or reserved/);
    assert.ok(visited.every(url => !url.includes("private.example.org")));
  }
  for (const ip of ["127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "240.0.0.1", "ff02::1", "fec0::1", "192.0.2.1", "2001:db8::1"]) await assert.rejects(checkReportAccess(share, { resolve: async () => [{ address: ip }], request: () => { throw Error("Must not fetch"); } }), /private or reserved/);
});

test("connections use pinned DNS results at the actual HTTPS boundary without authentication", async () => {
  const pinned = (_host, options, callback) => callback(null, options.all ? [{ address: "93.184.216.34", family: 4 }] : "93.184.216.34", 4);
  const transport = (_url, options, callback) => {
    assert.equal(options.lookup, pinned); assert.equal(options.auth, undefined); assert.equal(options.headers, undefined);
    const req = new EventEmitter(); req.end = () => { const response = Readable.from([Buffer.from(body)]); response.statusCode = 200; response.headers = { "content-type": "text/html" }; callback(response); }; return req;
  };
  assert.equal(await (await anonymousRequest(entry, { lookup: pinned }, transport)).text(), body);
  const addresses = { "reports.example.org": "93.184.216.34", "cdn.example.org": "8.8.8.8" };
  await checkReportAccess(share, { resolve: async host => [{ address: addresses[host] }], request: async (url, options) => {
    const host = new URL(url).hostname;
    const records = await new Promise((resolve, reject) => options.lookup(host, { all: true }, (error, records) => error ? reject(error) : resolve(records)));
    assert.deepEqual(records, [{ address: addresses[host], family: 4 }]);
    return publication()(url, options);
  } });
});

test("cyclic previews, excessive requests and stalled DNS checks have finite budgets", async () => {
  await assert.rejects(check(publication({}, '<iframe src="' + preview + '"></iframe>')), /cyclic/);
  await assert.rejects(checkReportAccess(share, { timeoutMs: 20, resolve: () => new Promise(() => {}), request: () => { throw Error("Must not fetch"); } }), /time budget/);
  const many = Array.from({ length: 50 }, (_, i) => '<iframe data-report-preview src="https://cdn.example.org/' + i + '"></iframe>').join("");
  const request = publication({}, body + many);
  await assert.rejects(check(async (url, options) => /^https:\/\/cdn.example.org\/\d+$/.test(url) ? html(body) : request(url, options)), /budget/);
});

test("hidden refresh/base/delivery metadata remains effective without CSS emulation", async () => {
  await assert.rejects(check(publication({ [share]: () => html('<meta hidden http-equiv="refresh" content="0;url=/login">' + body) })), /refresh/);
  await check(publication({ [preview]: () => html('<div hidden>' + loader + '</div>') }));
});

test("HTML and JSON use UTF-8 and empty or incomplete delivery is rejected", async () => {
  await assert.rejects(check(publication({ [entry]: () => html("Loading…") })), /no readable content/);
  await assert.rejects(check(publication({ [entry]: () => new Response("Report", { headers: { "content-type": "text/html; charset=GB18030" } }) })), /UTF-8/);
  await assert.rejects(check(publication({ [entry]: () => html('<meta charset="gb18030">' + body) })), /UTF-8/);
  await assert.rejects(check(publication({ [entry]: () => new Response(Buffer.from([0xff, 0xfe]), { headers: { "content-type": "text/html" } }) })), error => error.code === "ERR_ENCODING_INVALID_ENCODED_DATA");
  await assert.rejects(checkReportAccess("https://reports.example.org/direct.html", { resolve, request: async () => html(body) }), /public share URL/);
});

function transportResponse(bytes, headers, status = 200) {
  return (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = error => { if (error) req.emit("error", error); };
    req.end = () => queueMicrotask(() => { const response = Readable.from([bytes]); response.statusCode = status; response.headers = headers; callback(response); }); return req;
  };
}

test("compressed bodies are decoded and corrupt or unsupported encodings fail safely", async () => {
  for (const [encoding, compress] of [["gzip", gzipSync], ["br", brotliCompressSync], ["deflate", deflateSync]]) {
    assert.equal(await (await anonymousRequest(entry, {}, transportResponse(compress(Buffer.from(body)), { "content-type": "text/html", "content-encoding": encoding }))).text(), body);
    assert.deepEqual(await (await anonymousRequest(entry, {}, transportResponse(compress(Buffer.from('{"files":[]}')), { "content-type": "application/json", "content-encoding": encoding }))).json(), { files: [] });
    for (const bytes of [Buffer.from("invalid compressed bytes"), compress(Buffer.from(body.repeat(20))).subarray(0, 4)]) await assert.rejects(anonymousRequest(entry, {}, transportResponse(bytes, { "content-encoding": encoding })), error => /^(?:Z_(?:DATA|BUF)_ERROR|ERR_(?:_ERROR_FORMAT_)?PADDING_1)$/.test(error.code ?? ""));
  }
  for (const encoding of ["constructor", "__proto__", "unknown"]) await assert.rejects(anonymousRequest(entry, {}, transportResponse(Buffer.from(body), { "content-encoding": encoding })), /Unsupported/);
  await assert.rejects(anonymousRequest(entry, {}, transportResponse(gzipSync(Buffer.alloc(21 * 1024 * 1024, 65)), { "content-encoding": "gzip" })), /20 MiB/);
});

test("redirect bodies are discarded before decoding and empty responses do not crash", async () => {
  for (const encoding of ["unsupported", "gzip"]) {
    const response = await anonymousRequest(entry, {}, transportResponse(Buffer.from("unused"), { location: share, "content-encoding": encoding, "content-length": "999999999" }, 302));
    assert.equal(response.status, 302); assert.equal(response.headers.get("location"), share);
  }
  for (const status of [204, 205, 304]) assert.equal((await anonymousRequest(entry, {}, transportResponse(Buffer.alloc(0), {}, status))).status, status);
});

test("HTML parser allocation and depth are bounded independently of the checker", async () => {
  for (const content of ["<i></i>".repeat(500000), "<div>".repeat(300) + body + "</div>".repeat(300)]) await assert.rejects(reportDocument(content), /complexity/);
  assert.equal((await reportDocument(body)).readable, true);
});


test("required report embeds cannot be bypassed at the share entrance or by fallback text", async () => {
  const denied="https://reports.example.org/private";
  const frame='<iframe data-report-preview src="'+denied+'"></iframe>';
  await assert.rejects(check(publication({[share]:()=>html('<iframe src="'+preview+'"></iframe>'+frame),[denied]:()=>new Response("Forbidden",{status:403})})), /403/);
  await assert.rejects(check(publication({[denied]:()=>new Response("Forbidden",{status:403})}, '<iframe src="'+denied+'">Your browser does not support frames.</iframe>')), /403/);
  for(const source of ['', ' src=""', ' src="   "']) await assert.rejects(check(publication({},body+'<iframe data-report-preview'+source+'></iframe>')), /no source/);
  await check(publication({},body+'<iframe></iframe>'));
});

test("preview DNS is independently checked even on the share origin", async () => {
  let lookups=0;const visited=[];const request=publication();
  await assert.rejects(checkReportAccess(share,{resolve:async()=>++lookups===1?[{address:"93.184.216.34"}]:[{address:"93.184.216.34"},{address:"10.0.0.1"}],request:async(url,options)=>{visited.push(url);return request(url,options);}}),/private or reserved/);
  assert.deepEqual(visited,[share]);
  await assert.rejects(check(publication({[share]:()=>html('<iframe src="https://other.example.org/artifact-site/api/preview/abc/"></iframe>')})),/no report-service preview|authentication/);
});

test("quoted UTF-8 HTML declarations are valid", async () => {
  await check(publication({}, '<meta http-equiv="Content-Type" content=\'text/html; charset="UTF-8"\'>'+body));
});

test("the static export authorizes exact build scripts and excludes external script bodies", async () => {
  const {inlineScriptHashes}=await import('../scripts/secure-export.mjs');
  const hashes=inlineScriptHashes('<script>window.ready=true</script><script src="/app.js"></script>');
  assert.equal(hashes.length,1);
  assert.match(hashes[0],/^'sha256-[A-Za-z0-9+/]+=*'$/);
  assert.notDeepEqual(hashes,inlineScriptHashes('<script>window.ready=false</script>'));
});

test("foreign SVG elements cannot impersonate HTML report previews or metadata", async () => {
  await assert.rejects(check(publication({[share]:()=>html('<svg><iframe src="'+preview+'"></iframe></svg>')})), /no readable content|no report-service preview/);
  const document=await reportDocument('<svg><script id="artifact-delivery-config">{}</script><base href="https://invalid.example.org/"></base></svg>'+body);
  assert.equal(document.deliveryConfig,null);assert.equal(document.baseHref,null);
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
      await assert.rejects(anonymousRequest(entry,{signal:controller.signal},transport), error=>error.name==="TimeoutError" || error.name==="AbortError");
      assert.equal(req.destroyed,true);
      if(response)assert.equal(response.destroyed,true);
    } finally {clearTimeout(guard);}
  }
});


test("HTML previews inside SVG integration points retain their access checks", async () => {
  const denied="https://reports.example.org/private";
  for(const ancestor of ["template","noscript","iframe","script","style"]) {
    const content=body+'<svg><'+ancestor+'><foreignObject><iframe data-report-preview src="'+denied+'"></iframe></foreignObject></'+ancestor+'></svg>';
    await assert.rejects(check(publication({[denied]:()=>new Response("Forbidden",{status:403})},content)),/403/);
  }
});


test("delivered permission pages cannot stand in for a report", async () => {
  for(const text of ["Sign in","Log in","Access denied","Unauthorized","Forbidden","Please sign in to view this report.","You must log in to access this report.","Authentication required","Access denied Contact the owner.","Access denied Please sign in to view this report."]) await assert.rejects(check(publication({},"<h1>"+text+"</h1>")), /authentication|denies access/);
  await check(publication({},'<header>Sign in</header>'+body));
});

test("decoder failure closes a corrupt response before a server ends its stream", {timeout:1000}, async () => {
  let req,response;
  const transport=(_url,_options,callback)=>{
    req=new EventEmitter();req.destroyed=false;req.destroy=error=>{req.destroyed=true;if(error)req.emit("error",error);};
    req.end=()=>{response=new Readable({read(){}});response.headers={"content-encoding":"gzip"};response.statusCode=200;callback(response);response.push(Buffer.from("invalid compressed bytes"));};return req;
  };
  await assert.rejects(anonymousRequest(entry,{},transport), error=>error.code==="Z_DATA_ERROR");
  assert.equal(req.destroyed,true);assert.equal(response.destroyed,true);
});


test("foreign script and style source text cannot conceal a frame-only private report", async () => {
  const denied="https://reports.example.org/private";
  for(const tag of ["script","style"]) await assert.rejects(check(publication({[denied]:()=>new Response("Forbidden",{status:403})},'<svg><'+tag+'>text { fill: red; }</'+tag+'></svg><iframe src="'+denied+'"></iframe>')), /403/);
});


test("optional sign-in text does not block the actual public report preview", async () => {
  const publicEntry="https://cdn.example.org/public-report.html";
  await check(publication({[publicEntry]:()=>html(body)},'<header>Sign in</header><iframe data-report-preview src="'+publicEntry+'"></iframe><iframe src="about:blank"></iframe>'));
  const page=await reportDocument('<header>Sign in</header>'+loader);
  assert.equal(page.authentication,true);assert.ok(page.deliveryConfig);
});


test("denial headings and login forms are distinguished from optional account controls", async () => {
  for(const content of ['<h1>Access denied</h1><p>You do not have permission to view this report.</p>','<form><label>Email<input type="email"></label><label>Password<input type="password"></label><button>Sign in</button></form>']) await assert.rejects(check(publication({},content)),/authentication|denies access/);
  await check(publication({},'<header><h1>Sign in</h1><form><label>Email<input type="email"></label><label>Password<input type="password"></label></form></header>'+body));
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
      await assert.rejects(checkReportAccess(share,{resolve,timeoutMs:1000,request:(url,options)=>anonymousRequest(url,options,transport)}),error=>error.name==="TimeoutError" || error.name==="AbortError");
      assert.equal(req?.destroyed,true);if(response)assert.equal(response.destroyed,true);
    } finally {clearTimeout(guard);}
  }
});
