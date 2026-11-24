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
