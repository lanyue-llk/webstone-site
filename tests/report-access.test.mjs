import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";
import { anonymousRequest, checkReportAccess, reportDocument, reportLinks } from "../scripts/check-report-access.mjs";

const body = "<main><h1>Measured results</h1><p>Results and methodology.</p></main>";
const html = content => new Response(content, { headers: { "content-type": "text/html; charset=utf-8" } });
const resolve = async () => [{ address: "93.184.216.34" }];
function fixture(slug = "abc", content = body) {
  const share = `https://reports.example.org/artifact-site/s/${slug}`;
  const preview = `https://reports.example.org/artifact-site/api/preview/${slug}/index.html`;
  const manifest = `https://reports.example.org/${slug}-manifest?file=index.html`;
  const entry = `https://cdn.example.org/${slug}.html`;
  const delivery = { versionId: "ver_current" };
  const loader = `<script id="artifact-delivery-config">${JSON.stringify({ manifestUrl: manifest, file: "index.html" })}</script>`;
  function request(overrides = {}) {
    return async (url, options) => {
      assert.equal(options.credentials, "omit"); assert.equal(options.headers, undefined);
      if (Object.hasOwn(overrides, url)) return overrides[url]();
      if (url === share) return html(`<header>Optional account controls</header><iframe src="${preview}"></iframe>`);
      if (url === preview) return html(loader);
      if (url === manifest) return Response.json({ versionId: delivery.versionId, files: [{ path: "index.html", url: entry }], nextCursor: null });
      if (url === entry) return html(content);
      throw Error("Unexpected request: " + url);
    };
  }
  return { share, preview, manifest, entry, delivery, loader, request };
}
const sample = fixture();
const check = (request = sample.request(), extra = {}) => checkReportAccess(sample.share, { resolve, request, ...extra });

test("report shares and actual delivery are anonymously accessible", async () => {
  const visited = [], request = sample.request();
  await check(async (url, options) => { visited.push(url); return request(url, options); });
  assert.deepEqual(visited, [sample.share, sample.preview, sample.manifest, sample.entry]);
});

test("both language destinations are checked and withdrawn links are excluded", () => {
  assert.deepEqual(reportLinks({ benchmarks: [{ reportUrl: sample.share }] }, [{ id: "withdrawn", benchmarks: [{ reportUrl: sample.share + "-private" }] }], { reports: { current: { urls: { en: sample.share + "-en", zh: sample.share } } } }), [sample.share, sample.share + "-en"]);
});

test("private or missing report delivery blocks publication", async () => {
  for (const url of [sample.share, sample.preview, sample.manifest, sample.entry]) await assert.rejects(check(sample.request({ [url]: () => new Response("Forbidden", { status: 403 }) })), /403/);
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ files: [], nextCursor: null }) })), /entry is missing/);
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ files: null }) })), /Invalid report delivery/);
});

test("malformed manifest entries produce a delivery error", async () => {
  await assert.rejects(check(sample.request({ [sample.manifest]: () => Response.json({ files: [null] }) })), /Invalid report delivery manifest/);
});

test("public report revisions need no content fingerprint or version lock", async () => {
  await check(sample.request({ [sample.manifest]: () => Response.json({ versionId: "ver_new", files: [{ path: "index.html", url: sample.entry }], nextCursor: null }), [sample.entry]: () => html('<main><h1>Updated report</h1><p>New measurements.</p></main>') }));
});

test("optional account controls and unrelated media widgets do not block public reports", async () => {
  const publicReport = fixture("with-widgets", '<aside><form><input type="password"></form></aside>' + body + '<iframe src="about:blank"></iframe>');
  await checkReportAccess(publicReport.share, { resolve, request: publicReport.request() });
});

test("embedded reports from the same service must also open anonymously", async () => {
  const dependency = fixture("dependency", "<main><h1>English report</h1></main>");
  const parent = fixture("abc", '<iframe src="' + dependency.preview + '"></iframe>');
  const request = async (url, options) => url.includes("dependency") ? dependency.request()(url, options) : parent.request()(url, options);
  await check(request);
  for (const target of [dependency.preview, dependency.manifest, dependency.entry]) await assert.rejects(check(async (url, options) => url === target ? new Response("Forbidden", { status: 403 }) : request(url, options)), /403/);
  const cyclic = fixture("abc", '<iframe src="' + sample.preview + '"></iframe>');
  await assert.rejects(check(cyclic.request()), /cyclic/);
});

test("language-specific report previews fetch their own actual entry", async () => {
  const preview = sample.preview.replace("index.html", "en/index.html");
  const manifest = sample.manifest.replace("index.html", "en%2Findex.html");
  const entry = "https://cdn.example.org/english.html";
  const visited = [];
  const request = sample.request({
    [sample.share]: () => html(`<iframe src="${preview}"></iframe>`),
    [preview]: () => html(`<script id="artifact-delivery-config">${JSON.stringify({ manifestUrl: sample.manifest, file: "en/index.html" })}</script>`),
    [manifest]: () => Response.json({ files: [{ path: "en/index.html", url: entry }], nextCursor: null }),
    [sample.manifest]: () => { throw new Error("Must not fetch default-language manifest"); },
    [entry]: () => html(body),
  });
  await check(async (url, options) => { visited.push(url); return request(url, options); });
  assert.ok(visited.includes(manifest)); assert.ok(visited.includes(entry)); assert.ok(!visited.includes(sample.entry));
});

test("HTTP-200 sign-in wrappers cannot stand in for the service's public preview", async () => {
  for (const content of ['<h1>Sign in</h1>', '<svg><iframe src="' + sample.preview + '"></iframe></svg>', '<iframe src="https://other.example.org/artifact-site/api/preview/abc/"></iframe>']) await assert.rejects(check(sample.request({ [sample.share]: () => html(content) })), /no report-service preview/);
  await assert.rejects(check(sample.request({ [sample.preview]: () => html("<h1>Sign in</h1>") })), /delivery manifest/);
});

test("redirects remain public and stop before requesting sign-in destinations", async () => {
  const start = "https://reports.example.org/old-report", visited = [], request = sample.request();
  await checkReportAccess(start, { resolve, request: async (url, options) => { visited.push(url); return url === start ? new Response(null, { status: 302, headers: { location: sample.share } }) : request(url, options); } });
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
  let calls = 0;
  const frames = Array.from({length:25}, (_,i)=>'<iframe src="https://reports.example.org/artifact-site/api/preview/child'+i+'/index.html"></iframe>').join('');
  const parent = fixture("abc", frames), base = parent.request();
  await assert.rejects(check(async (url, options) => {
    calls++;
    if (url.includes('/api/preview/child')) return html('<script id="artifact-delivery-config">{"manifestUrl":"https://reports.example.org/leaf-manifest","file":"index.html"}</script>');
    if (url === 'https://reports.example.org/leaf-manifest?file=index.html') return Response.json({files:[{path:'index.html',url:'https://cdn.example.org/leaf.html'}],nextCursor:null});
    if (url === 'https://cdn.example.org/leaf.html') return html(body);
    return base(url,options);
  }), /request or time budget/);
  assert.equal(calls,40);
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
      await assert.rejects(checkReportAccess(sample.share,{resolve,timeoutMs:1000,request:(url,options)=>anonymousRequest(url,options,transport)}),error=>error.name==="TimeoutError" || error.name==="AbortError");
      assert.equal(req?.destroyed,true);if(response)assert.equal(response.destroyed,true);
    } finally {clearTimeout(guard);}
  }
});


test("delivered HTML refresh cannot redirect readers to sign-in", async () => {
  await assert.rejects(check(sample.request({[sample.entry]:()=>html('<meta http-equiv="refresh" content="0;url=/login">')})), /HTML refresh/);
});

test("redirected entries resolve relative report frames against the final entry URL", async () => {
  const final='https://cdn.example.org/reports/index.html', child='https://cdn.example.org/reports/child.html';
  const visited=[]; const request=sample.request({
    [sample.entry]:()=>new Response(null,{status:302,headers:{location:final}}),
    [final]:()=>html('<iframe data-report-preview src="child.html"></iframe>'),
    [child]:()=>html(body)
  });
  await check(async (url,options)=>{visited.push(url);return request(url,options);});
  assert.ok(visited.includes(child));
});

test("srcdoc inherits URL resolution without changing its report-service origin", async () => {
  const nested='https://reports.example.org/artifact-site/api/preview/private/index.html';
  const request=sample.request({
    [sample.preview]:()=>html(`<base href="https://cdn.example.org/">${sample.loader}<iframe srcdoc='<iframe src="${nested}"></iframe>'></iframe>`),
    [nested]:()=>new Response('Forbidden',{status:403})
  });
  await assert.rejects(check(request),/403/);
});

test("redirect destinations get independent DNS validation and pinned records", async () => {
  const destination='https://redirect.example.org/artifact-site/s/abc';
  for (const records of [[{address:'10.0.0.1'}],[{address:'8.8.8.8'},{address:'10.0.0.1'}]]) {
    const visited=[];
    await assert.rejects(check(async url=>{visited.push(url);return new Response(null,{status:302,headers:{location:destination}});},{resolve:async host=>host==='redirect.example.org'?records:resolve()}),/private or reserved/);
    assert.deepEqual(visited,[sample.share]);
  }
  const request=sample.request(); let checkedDestination=false;
  await check(async (url,options)=>{
    if(url===sample.share)return new Response(null,{status:302,headers:{location:destination}});
    if(url===destination){
      const records=await new Promise((done,fail)=>options.lookup('redirect.example.org',{all:true},(error,value)=>error?fail(error):done(value)));
      assert.deepEqual(records,[{address:'8.8.8.8',family:4}]);checkedDestination=true;
      return html('<iframe src="https://redirect.example.org/artifact-site/api/preview/abc/index.html"></iframe>');
    }
    if(url==='https://redirect.example.org/artifact-site/api/preview/abc/index.html') return html(sample.loader);
    return request(url,options);
  },{resolve:async host=>host==='redirect.example.org'?[{address:'8.8.8.8'}]:resolve()});
  assert.equal(checkedDestination,true);
});


test("inline report refresh and unsupported delivery formats are rejected", async () => {
  await assert.rejects(check(sample.request({[sample.entry]:()=>html(`<iframe data-report-preview srcdoc='<meta http-equiv="refresh" content="0;url=/login">'></iframe>`)})),/HTML refresh/);
  for(const type of ['application/json','application/pdf']) await assert.rejects(check(sample.request({[sample.entry]:()=>new Response('non-HTML payload',{headers:{'content-type':type}})})),/HTML report entry/);
});

test("required CDN children retain the containing report-service context", async () => {
  const child='https://cdn.example.org/reports/child.html';
  const nested='https://reports.example.org/artifact-site/api/preview/private/index.html';
  await assert.rejects(check(sample.request({
    [sample.entry]:()=>html('<iframe data-report-preview src="'+child+'"></iframe>'),
    [child]:()=>html('<iframe src="'+nested+'"></iframe>'),
    [nested]:()=>new Response('Forbidden',{status:403})
  })),/403/);
});

test("historical report URLs are checked only for published version-report entries", () => {
  const historical=sample.share+'-historical',withdrawn=sample.share+'-withdrawn';
  const links=reportLinks({benchmarks:[]},[
    {id:'historical',benchmarks:[{reportUrl:historical}]},
    {id:'withdrawn',benchmarks:[{reportUrl:withdrawn}]}
  ],{reports:{historical:{versionReport:true}}});
  assert.deepEqual(links,[historical]);
});

test("shared delivery is checked separately for each report-service origin", async () => {
  const first='https://reports.example.org/artifact-site/api/preview/first/index.html';
  const second='https://reports.example.org/artifact-site/api/preview/second/index.html';
  const redirected='https://other.example.org/artifact-site/api/preview/second/index.html';
  const manifest='https://cdn.example.org/shared-manifest?file=index.html';
  const entry='https://cdn.example.org/shared.html';
  const privatePreview='https://other.example.org/artifact-site/api/preview/private/index.html';
  const loader='<script id="artifact-delivery-config">'+JSON.stringify({file:'index.html',manifestUrl:manifest})+'</script>';
  const request=sample.request({
    [sample.entry]:()=>html('<iframe src="'+first+'"></iframe><iframe src="'+second+'"></iframe>'),
    [first]:()=>html(loader),
    [second]:()=>new Response(null,{status:302,headers:{location:redirected}}),
    [redirected]:()=>html(loader),
    [manifest]:()=>Response.json({files:[{path:'index.html',url:entry}]}),
    [entry]:()=>html('<iframe src="'+privatePreview+'"></iframe>'),
    [privatePreview]:()=>new Response('Forbidden',{status:403})
  });
  await assert.rejects(check(request),/403/);
});


test("anonymous delivery does not judge owner-authored report content", async () => {
  for (const content of ['', ' ', '<html></html>', '<form><input type="password"><button>Sign in</button></form>']) {
    await check(sample.request({[sample.entry]:()=>html(content)}));
  }
});

test("nested shares at the depth boundary are not traversed twice", async () => {
  const base=sample.request(); const visited=[];
  await check(async (url,options)=>{
    visited.push(url);
    const match=/\/(?:s|api\/preview)\/level(\d+)/.exec(url);
    if(match) {
      const level=Number(match[1]);
      if(url.includes('/s/'))return html('<iframe src="https://reports.example.org/artifact-site/api/preview/level'+level+'/index.html"></iframe>');
      return html('<script id="artifact-delivery-config">'+JSON.stringify({file:'index.html',manifestUrl:'https://reports.example.org/manifest'+level})+'</script>');
    }
    const manifest=/manifest(\d+)/.exec(url);
    if(manifest)return Response.json({files:[{path:'index.html',url:'https://cdn.example.org/level'+manifest[1]+'.html'}]});
    const entry=/cdn.example.org\/level(\d+)\.html/.exec(url);
    if(entry){const level=Number(entry[1]);return html(level===5?body:'<iframe src="https://reports.example.org/artifact-site/s/level'+(level+1)+'"></iframe>');}
    if(url===sample.entry)return html('<iframe src="https://reports.example.org/artifact-site/s/level1"></iframe>');
    return base(url,options);
  });
  for(let level=1;level<=5;level++) {
    for(const url of ['https://reports.example.org/artifact-site/s/level'+level,'https://reports.example.org/artifact-site/api/preview/level'+level+'/index.html','https://reports.example.org/manifest'+level+'?file=index.html','https://cdn.example.org/level'+level+'.html']) assert.equal(visited.filter(item=>item===url).length,1,url);
  }
});

test("wire limits stop identity and low-output compressed streams before EOF", {timeout:6000}, async () => {
  const empty=gzipSync(Buffer.alloc(0)); const extra=Buffer.alloc(65535); const header=Buffer.from(empty.subarray(0,10));header[3]=4;
  const gzipMember=Buffer.concat([header,Buffer.from([255,255]),extra,empty.subarray(10)]);
  for(const [encoding,chunk] of [['identity',Buffer.alloc(1024*1024)],['gzip',gzipMember]]) {
    let req,response,guard,ended=false;
    const transport=(_url,_options,callback)=>{
      req=new EventEmitter();req.destroyed=false;req.destroy=error=>{req.destroyed=true;response.destroy(error);};
      req.end=()=>{
        guard=setTimeout(()=>req.destroy(new Error('Independent test guard expired')),5000);
        response=new Readable({read(){this.push(chunk);}});
        response.statusCode=200;response.headers={'content-encoding':encoding};response.on('end',()=>{ended=true;});callback(response);
      };
      return req;
    };
    try { await assert.rejects(anonymousRequest(sample.entry,{},transport),/20 MiB/); } finally { clearTimeout(guard); }
    assert.equal(req.destroyed,true);assert.equal(response.destroyed,true);assert.equal(ended,false);
  }
});

test("encoded sign-in redirects are rejected before requesting the login route", async () => {
  for (const path of ["/%6cogin", "/sign%69n", "/auth%2Fcallback"]) {
    const visited = [];
    await assert.rejects(check(async url => {
      visited.push(url);
      return new Response(null, { status: 302, headers: { location: path } });
    }), /sign-in/);
    assert.deepEqual(visited, [sample.share]);
  }
});

test("decoded-size limits stop high-expansion streams before EOF", { timeout: 5000 }, async () => {
  const encoded = gzipSync(Buffer.alloc(21 * 1024 * 1024, 65));
  assert.ok(encoded.length < 100000);
  let req, response, sent = false, ended = false, guard;
  const transport = (_url, _options, callback) => {
    req = new EventEmitter(); req.destroyed = false;
    req.destroy = error => { req.destroyed = true; response.destroy(error); };
    req.end = () => {
      guard = setTimeout(() => req.destroy(new Error("Independent test guard expired")), 3000);
      response = new Readable({ read() { if (!sent) { sent = true; this.push(encoded); } } });
      response.statusCode = 200; response.headers = { "content-encoding": "gzip" };
      response.on("end", () => { ended = true; }); callback(response);
    };
    return req;
  };
  try { await assert.rejects(anonymousRequest(sample.entry, {}, transport), /Decoded report exceeds/); }
  finally { clearTimeout(guard); }
  assert.equal(req.destroyed, true); assert.equal(response.destroyed, true); assert.equal(ended, false);
});
