import test from "node:test";
import assert from "node:assert/strict";
import { anonymousRequest, checkReportAccess, reportLinks } from "../scripts/check-report-access.mjs";

const address = "https://reports.example.org/report";
const html = body => new Response(body, { headers: { "content-type": "text/html" } });
const resolve = async () => [{ address: "93.184.216.34" }];
const check = (request, url = address) => checkReportAccess(url, { resolve, request });

test("report checks include catalog articles and result-specific reports once", () => {
  assert.deepEqual(reportLinks({ benchmarks: [{ reportUrl: address }] }, [{ id: "published", benchmarks: [{ reportUrl: address }, { reportUrl: address + "-v2" }, { reportUrl: null }] }], { reports: { published: { versionReport: true } } }), [address, address + "-v2"]);
});

test("an anonymous reader can open HTML reports without cookies or credentials", async () => {
  await check(async (_, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    return html("<h1>Web Search evaluation</h1><p>Results and methodology.</p>");
  });
  await assert.rejects(check(async () => new Response("%PDF-1.7 content", { headers: { "content-type": "application/pdf" } })), /PDF reports require/);
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

test("explicit denial headings fail even when a site adds lengthy navigation", async () => {
  for (const heading of ["Access denied", "Sign in to view this work"]) {
    await assert.rejects(check(async () => html('<h1>'+heading+'</h1><nav>'+('Navigation '.repeat(600))+'</nav>')), /access-denied/);
  }
});

test("a direct delivery preview must expose its manifest and report", async () => {
  await assert.rejects(check(async target => target.includes('/manifest') ? new Response('Forbidden',{status:403}) : html('<script id="artifact-delivery-config">{"manifestUrl":"https://reports.example.org/manifest","file":"index.html"}</script>')), /403/);
});

test("connections use the validated addresses instead of a second DNS lookup", async () => {
  await check(async (_, options) => {
    const pinned = await new Promise((resolve, reject) => options.lookup('reports.example.org', {all:true}, (error, records) => error ? reject(error) : resolve(records)));
    assert.deepEqual(pinned, [{address:'93.184.216.34',family:4}]);
    return html('<h1>Measured results</h1>');
  });
});


test("empty application roots and script-only redirects do not count as reports", async () => {
  for (const body of ['<html><head><title>Report</title></head><body><div id="app"></div></body></html>', "<script>location.href='/login'</script>"]) await assert.rejects(check(async () => html(body)), /no readable content/);
});

test("anonymous transport handles empty HTTP responses without uncaught exceptions", async () => {
  const { EventEmitter } = await import("node:events");
  for (const status of [204, 205, 304]) {
    const transport = (_url, _options, callback) => {
      const req = new EventEmitter();
      req.end = () => {
        const response = new EventEmitter();
        response.statusCode = status; response.headers = {};
        callback(response); response.emit("end");
      };
      return req;
    };
    const response = await anonymousRequest(address, {}, transport);
    assert.equal(response.status, status);
    assert.equal(await response.text(), "");
  }
});


test("iframe-only reports outside the hosted wrapper validate their embedded document", async () => {
  await assert.rejects(check(async target => target === address ? html('<iframe src="/private"></iframe>') : new Response('Forbidden', {status:403})), /403/);
});

test("every secondary destination receives DNS validation before any network request", async () => {
  const resolve = async hostname => [{address: hostname === 'private.example.org' ? '10.0.0.1' : '93.184.216.34'}];
  for (const response of [new Response(null,{status:302,headers:{location:'https://private.example.org/report'}}), html('<iframe src="https://private.example.org/report"></iframe>'), html('<script id="artifact-delivery-config">{"manifestUrl":"https://private.example.org/manifest","file":"index.html"}</script>')]) {
    const visited=[];
    await assert.rejects(checkReportAccess(address,{resolve,request:async target=>{visited.push(target);return response}}),/private or reserved/);
    assert.deepEqual(visited,[address]);
  }
});

test("the HTTPS transport receives the validated lookup callback", async () => {
  const {EventEmitter}=await import('node:events');
  const lookup=(_host,_options,callback)=>callback(null,'93.184.216.34',4);
  await anonymousRequest(address,{lookup},(_address,options,callback)=>{
    assert.equal(options.lookup,lookup);
    options.lookup('reports.example.org',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4)});
    const req=new EventEmitter();req.end=()=>{const response=new EventEmitter();response.statusCode=200;response.headers={};callback(response);response.emit('data',Buffer.from('report'));response.emit('end')};return req;
  });
});


test("optional closed login dialogs do not prevent anonymous report reading", async () => {
  await check(async()=>html('<h1>Benchmark results</h1><p>Measured quality and timing.</p><dialog><h2>Sign in</h2><input type="password"></dialog>'));
});

test("readable preview wrappers still require accessible embedded reports", async () => {
  await assert.rejects(check(async target=>target===address?html('<h1>Report preview</h1><iframe src="/private"></iframe>'):new Response('Forbidden',{status:403})),/403/);
});


test("inert HTML, comments and hidden text do not expose readable reports or live previews", async () => {
  for (const body of ['<template><h1>Results</h1></template><div id="app"></div>','<div hidden>Results</div>','<div style="display: none">Results</div>']) await assert.rejects(check(async()=>html(body)),/no readable content/);
  await check(async()=>html('<h1>Measured results</h1><!-- <iframe src="/old-preview"></iframe> --><template><iframe src="/private"></iframe></template><iframe data-src="/unused"></iframe>'));
});

test("a non-heading login gate fails regardless of lengthy navigation", async () => {
  await assert.rejects(check(async()=>html('<p>You are not signed in.</p><nav>'+('Navigation '.repeat(600))+'</nav>')),/access-denied/);
});


test("standalone access-denied messages in generic containers fail beside navigation", async () => {
  for (const tag of ['div','span']) await assert.rejects(check(async()=>html('<nav>Home</nav><'+tag+' role="alert">You are not signed in.</'+tag+'>')),/access-denied/);
});

test("embedded report destinations use the document base URL", async () => {
  const visited=[];
  await check(async target=>{visited.push(target);return target===address?html('<base href="https://cdn.example.org/reports/"><h1>Report preview</h1><iframe src="report.html"></iframe>'):html('<h1>Measured results</h1>')});
  assert.deepEqual(visited,[address,'https://cdn.example.org/reports/report.html']);
});


test("HTML refresh pages require a final report URL", async () => {
  await assert.rejects(check(async()=>html('<meta http-equiv="refresh" content="0;url=/login"><p>Redirecting…</p>')),/final public URL/);
});

test("inline iframe documents take precedence over their fallback URLs", async () => {
  await assert.rejects(check(async()=>html('<iframe src="/public" srcdoc="&lt;h1&gt;Access denied&lt;/h1&gt;"></iframe>')),/sign-in/);
  await check(async()=>html('<iframe srcdoc="&lt;h1&gt;Measured results&lt;/h1&gt;"></iframe>'));
});

test("public report navigation can offer optional sign-in", async () => {
  await check(async()=>html('<nav><a href="/login"><span>Sign in</span></a></nav><h1>Measured results</h1>'));
});


test("optional sign-in navigation in a header does not block public results", async () => {
  await check(async () => html('<header><a href="/login">Sign in</a></header><main><h1>Measured results</h1></main>'));
});

test("loading-only redirect shells cannot pass as public reports", async () => {
  await assert.rejects(check(async () => html("<p>Loading…</p><script>location.href='/login'</script>")), /no readable content/);
});

test("hosted wrappers can deliver readable inline reports", async () => {
  await check(async () => html('<iframe srcdoc="&lt;h1&gt;Measured results&lt;/h1&gt;"></iframe>'), 'https://reports.example.org/artifact-site/s/inline');
});

test("deeply nested HTML is rejected within a bounded traversal", async () => {
  await assert.rejects(check(async () => html('<div>'.repeat(300) + 'Measured results'.repeat(5000) + '</div>'.repeat(300))), /complexity limit/);
});


test("formatted denial headings and explicit sign-in buttons require authentication", async () => {
  for (const body of ['<h1>Access <em>denied</em></h1><p>Contact the owner.</p>', '<h1>Private report</h1><button>Sign in to view this work</button>']) await assert.rejects(check(async () => html(body)), /access-denied/);
});

test("public redirects reach the final report and sign-in redirects fail before fetching", async () => {
  const visited = [];
  await check(async url => { visited.push(url); return url === address ? new Response(null, {status:302,headers:{location:'/final'}}) : html('<h1>Measured results</h1>'); });
  assert.deepEqual(visited, [address, 'https://reports.example.org/final']);
  const loginRequests=[];
  await assert.rejects(check(async url => { loginRequests.push(url);return new Response(null,{status:302,headers:{location:'/login'}}); }), /sign-in/);
  assert.deepEqual(loginRequests,[address]);
});

test("manifest entries and mixed DNS answers cannot reach private networks", async () => {
  const visited=[];
  await assert.rejects(checkReportAccess(address,{resolve:async host => host==='private.example.org' ? [{address:'93.184.216.34'},{address:'10.0.0.1'}] : resolve(), request:async url => {
    visited.push(url);
    return url===address ? html('<script id="artifact-delivery-config">{"manifestUrl":"https://reports.example.org/manifest","file":"index.html"}</script>') : Response.json({files:[{path:'index.html',url:'https://private.example.org/report'}],nextCursor:null});
  }}), /private or reserved/);
  assert.deepEqual(visited,[address,'https://reports.example.org/manifest?file=index.html']);
});

test("repeated previews are deduplicated and distinct requests have a finite budget", async () => {
  let requests=0;
  await check(async url => { requests++;return html(url===address ? '<iframe src="/child"></iframe>'.repeat(1000) : '<h1>Measured results</h1>'); });
  assert.equal(requests,2);
  await assert.rejects(check(async url => html(url===address ? Array.from({length:100},(_,i)=>'<iframe src="/child'+i+'"></iframe>').join('') : '<h1>Measured results</h1>')), /budget/);
});


test("authentication gates recognize log-in variants without rejecting optional navigation", async () => {
  for (const body of ['<h1>Log in to view this report</h1>', '<h1>Private report</h1><button>Login required</button>']) await assert.rejects(check(async () => html(body)), /access-denied/);
  await check(async () => html('<a href="/login">Log in</a><h1>Measured results</h1>'));
});

test("DNS lookups have the same overall deadline as report retrieval", async () => {
  await assert.rejects(checkReportAccess(address,{timeoutMs:20,resolve:()=>new Promise(()=>{}),request:()=>{throw Error('Must not fetch');}}), /time budget/);
});

test("self-referencing previews and multi-page cycles never count as readable reports", async () => {
  await assert.rejects(check(async () => html('<iframe src="/report"></iframe>')), /cyclic/);
  await assert.rejects(check(async url => html('<iframe src="'+(url===address?'/next':'/report')+'"></iframe>')), /cyclic/);
});

test("compressed HTML and manifests are decoded before inspection", async () => {
  const {Readable}=await import('node:stream');const {EventEmitter}=await import('node:events');
  const {gzipSync,brotliCompressSync,deflateSync}=await import('node:zlib');
  for (const [encoding,compress] of [['gzip',gzipSync],['br',brotliCompressSync],['deflate',deflateSync]]) {
    const transport = (body,type='text/html') => (_url,_options,callback) => {
      const req=new EventEmitter();req.destroy=error=>{if(error)req.emit('error',error);};req.end=()=>{const response=Readable.from([compress(Buffer.from(body))]);response.statusCode=200;response.headers={'content-type':type,'content-encoding':encoding};callback(response);};return req;
    };
    const response=await anonymousRequest(address,{},transport('<h1>Access denied</h1>'));
    await assert.rejects(check(async()=>response),/access-denied/);
    const manifest=await anonymousRequest(address,{},transport('{"files":[]}', 'application/json'));
    assert.deepEqual(await manifest.json(),{files:[]});
  }
});


test("authentication failure examples in report prose remain readable", async () => {
  await check(async () => html('<h1>Results</h1><p>Unauthorized requests returned <code>Forbidden</code>, as expected.</p>'));
  await assert.rejects(check(async () => html('<h1>Please sign in to view this report</h1><button>Continue with Google</button>')), /access-denied/);
});

test("malformed content encodings reject asynchronously without terminating the checker", async () => {
  const {Readable}=await import('node:stream');const {EventEmitter}=await import('node:events');
  for(const encoding of ['constructor','__proto__','unknown']) {
    const transport=(_url,options,callback)=>{
      assert.equal(options.auth,undefined);assert.equal(options.headers,undefined);
      const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const response=Readable.from(['body']);response.statusCode=200;response.headers={'content-type':'text/html','content-encoding':encoding};callback(response);});return req;
    };
    await assert.rejects(anonymousRequest(address,{},transport),/Unsupported.*encoding/);
  }
});


test("large fragmented documents cannot exhaust the checker process", async () => {
  await assert.rejects(check(async () => html('<i></i>'.repeat(500000))), /complexity/);
  await check(async () => html('<h1>Measured results</h1>'));
});

test("collapsed account disclosures do not hide otherwise public reports", async () => {
  await check(async () => html('<h1>Measured results</h1><details><summary>Account</summary><input type="password"></details>'));
  await assert.rejects(check(async () => html('<details open><summary>Account</summary><input type="password"></details>')), /access-denied/);
});

test("access-required instructions are recognized across multiple sentences", async () => {
  await assert.rejects(check(async () => html('<p>Sign in to view this report. Contact the owner for access.</p>')), /access-denied/);
});

test("HTML checks work when the checker is imported by an ESM command", async () => {
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const script = `import {reportDocument} from ${JSON.stringify(new URL('../scripts/check-report-access.mjs',import.meta.url).href)};if(!(await reportDocument('<h1>Measured results</h1>')).readable)process.exit(1);`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',script]);
});


test("inline text cannot suppress a fetched iframe at the same string", async () => {
  await assert.rejects(check(async url=>url===address ? html('<iframe srcdoc="https://reports.example.org/private"></iframe><iframe src="https://reports.example.org/private"></iframe>') : new Response('Forbidden',{status:403})), /403/);
});

test("visible aria-hidden messages, formatted Chinese gates and semantic alerts fail", async () => {
  for(const body of ['<h1>Private report</h1><div aria-hidden="true"><h2>Access denied</h2></div>', '<h1>需要<strong>登录</strong></h1><p>Contact the owner.</p>', '<main><span role="alert">Access denied</span><p>Contact the owner.</p></main>']) await assert.rejects(check(async()=>html(body)), /access-denied/);
  await check(async()=>html('<div aria-hidden="true">Measured results</div>'));
});

test("page chrome cannot turn a main loading shell into a readable report", async () => {
  await assert.rejects(check(async()=>html('<header>Report Library</header><main><p>Loading…</p></main><footer>Copyright 2026</footer>')), /no readable content/);
});

test("PDFs are not approved without a dedicated password-free page validation", async () => {
  for(const body of ['%PDF-1.7 truncated','%PDF-1.7 /Encrypt 1 0 R']) await assert.rejects(check(async()=>new Response(body,{headers:{'content-type':'application/pdf'}})), /PDF reports require/);
});


test("rendered line breaks preserve access messages", async () => {
  await assert.rejects(check(async()=>html('<h1>Access<br>denied</h1><p>Contact the owner.</p>')), /access-denied/);
});

test("optional account navigation stays separate from report access", async () => {
  await check(async()=>html('<main>Measured results</main><nav><a href="/login">Sign in to view your account</a></nav>'));
});

test("visible iframes in page chrome still require anonymous access", async () => {
  await assert.rejects(check(async url=>url===address ? html('<h1>Report preview</h1><aside><iframe src="/private"></iframe></aside>') : new Response('Forbidden',{status:403})), /403/);
});


test("visible auth forms, whitespace and sentence punctuation cannot hide a gate", async () => {
  for(const body of ['<main><h1>Private report</h1><aside><form><p>Access denied</p><input type="password"></form></aside></main>', '<h1>'+(' '.repeat(512))+'Access denied</h1><p>Contact the owner.</p>', '<h1>Access denied.</h1><p>Contact the owner.</p>']) await assert.rejects(check(async()=>html(body)), /access-denied/);
});

test("empty primary containers do not suppress public body content", async () => {
  await check(async()=>html('<div><h1>Measured results</h1><p>Results and methodology.</p></div><article></article>'));
});

test("corrupt and truncated supported encodings reject through asynchronous decoder errors", async () => {
  const {Readable}=await import('node:stream');const {EventEmitter}=await import('node:events');
  const {gzipSync,brotliCompressSync,deflateSync}=await import('node:zlib');
  for(const [encoding,compress] of [['gzip',gzipSync],['br',brotliCompressSync],['deflate',deflateSync]]) for(const body of [Buffer.from('invalid compressed bytes'),compress(Buffer.from('<h1>Measured results</h1>'.repeat(20))).subarray(0,4)]) {
    const transport=(_url,_options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const response=Readable.from([body]);response.statusCode=200;response.headers={'content-type':'text/html','content-encoding':encoding};callback(response);});return req;};
    await assert.rejects(anonymousRequest(address,{},transport));
  }
});
