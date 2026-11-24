import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  launchReportBrowser,
  verifyReportNavigation,
  reportDestination,
} from "../scripts/report-browser.mjs";

import https from "node:https";
import { connect } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
let browser, server, directory, respond;
const streams = new Set();
const credentialViolations = [],
  connectorAttempts = [],
  pinnedAddresses = [];
let streamBytes = 0;
beforeEach(() => {
  credentialViolations.length = 0;
  connectorAttempts.length = 0;
  pinnedAddresses.length = 0;
  streamBytes = 0;
});
afterEach(() => {
  assert.deepEqual(credentialViolations, []);
  assert.ok(pinnedAddresses.every((address) => address === "93.184.216.34"));
});
const proxyOptions = {
  resolve: async () => [{ address: "93.184.216.34" }],
  connect: (options) => {
    connectorAttempts.push(options.host);
    options.lookup(options.host, { all: true }, (_error, records) =>
      pinnedAddresses.push(...records.map((record) => record.address)),
    );
    return connect({ host: "127.0.0.1", port: server.address().port });
  },
};
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "report-navigation-"));
  const keyPath = join(directory, "key.pem"),
    certPath = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=reports.example.org",
    ],
    { stdio: "ignore" },
  );
  const key = await readFile(keyPath),
    cert = await readFile(certPath);
  const spki = createHash("sha256")
    .update(
      new X509Certificate(cert).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
  server = https.createServer({ key, cert }, async (request, response) => {
    try {
      if (request.headers.authorization || request.headers.cookie)
        credentialViolations.push(
          "Credentials reached the public report server",
        );
      if (request.url.startsWith("/large?")) {
        response.writeHead(200, {
          "content-type": "text/plain",
          "access-control-allow-origin": "*",
        });
        streams.add(response);
        const timer = setInterval(() => {
          streamBytes += 16384;
          response.write(Buffer.alloc(16384, 65));
        }, 5);
        response.once("close", () => {
          clearInterval(timer);
          streams.delete(response);
        });
        return;
      }
      const result = await respond(
        "https://" + request.headers.host + request.url,
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await launchReportBrowser({
    args: ["--ignore-certificate-errors-spki-list=" + spki],
  });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
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
  return async (url) => {
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
const check = (overrides = {}, extra = {}) => {
  respond = fixture(overrides);
  return verifyReportNavigation(browser, share, delivery, {
    timeoutMs: 3000,
    proxyOptions,
    ...extra,
  });
};

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
        proxyOptions: {
          resolve: async () => [{ address: "127.0.0.1" }],
          connect: () => {
            fetched = true;
            throw new Error("Must not request");
          },
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
    respond = fixture(overrides);
    const result = verifyReportNavigation(browser, share, graph, {
      proxyOptions,
      timeoutMs: 3000,
    });
    if (allowed) await result;
    else await assert.rejects(result, /Anonymous browser/);
  }
});

test("document redirects preserve their final URL and relative iframe base", async () => {
  const final = "https://reports.example.org/final/index.html";
  const child = "https://reports.example.org/final/child.html";
  respond = fixture({
    [preview]: () =>
      new Response(null, { status: 302, headers: { location: final } }),
    [final]: () => html(`<iframe src="child.html"></iframe>`),
    [child]: () => html("<main>Report</main>"),
  });
  await verifyReportNavigation(
    browser,
    share,
    { frames: [preview, child], entries: [child] },
    { proxyOptions, timeoutMs: 3000 },
  );
});

test("different query-selected files remain distinct requirements", async () => {
  const en = entry + "?file=en",
    zh = entry + "?file=zh";
  assert.notEqual(reportDestination(en), reportDestination(zh));
  respond = fixture({
    [entry]: () => html(`<iframe src="${en}"></iframe>`),
    [en]: () => html("English"),
  });
  await assert.rejects(
    verifyReportNavigation(
      browser,
      share,
      { frames: [preview], entries: [en, zh] },
      { proxyOptions, timeoutMs: 1500 },
    ),
    /Anonymous browser/,
  );
  assert.equal(
    reportDestination(
      "https://bucket.cos.ap-hongkong.myqcloud.com/index.html?q-signature=abc&file=en",
    ),
    "https://bucket.cos.ap-hongkong.myqcloud.com/index.html?file=en",
  );
  assert.notEqual(
    reportDestination(entry + "?q-signature=abc"),
    reportDestination(entry + "?q-signature=def"),
  );
});

test("COS supports both native and S3 signing without losing the selected file", () => {
  const prefix =
    "https://bucket.cos.ap-nanjing.myqcloud.com/index.html?file=en&";
  assert.equal(
    reportDestination(
      prefix +
        "X-Amz-Signature=first&X-Amz-Date=one&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD",
    ),
    reportDestination(
      prefix +
        "X-Amz-Signature=second&X-Amz-Date=two&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD",
    ),
  );
  assert.notEqual(
    reportDestination(prefix + "X-Amz-Signature=first"),
    reportDestination(
      prefix.replace("file=en", "file=zh") + "X-Amz-Signature=first",
    ),
  );
});

test("a redirect to a private destination never bypasses the public proxy", async () => {
  await assert.rejects(
    check({
      [preview]: () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
    }),
    /Anonymous browser/,
  );
  assert.ok(!connectorAttempts.includes("127.0.0.1"));
});

test("a loader that downloads but never renders the entry is inaccessible", async () => {
  await assert.rejects(
    check({
      [preview]: () =>
        html(
          loader.replace(
            "document.open();document.write(html);document.close();",
            "throw new Error('Delivery failed');",
          ),
        ),
    }),
    /Anonymous browser/,
  );
});

test("an entry fetched as data must also satisfy its required iframe", async () => {
  respond = fixture({
    [share]: () =>
      html(
        `<iframe src="${preview}"></iframe><iframe src="${entry}"></iframe>`,
      ),
    [entry]: () => html("<main>Report</main>", { "x-frame-options": "DENY" }),
  });
  await assert.rejects(
    verifyReportNavigation(
      browser,
      share,
      { frames: [preview, entry], entries: [entry] },
      { proxyOptions, timeoutMs: 1500 },
    ),
    /Anonymous browser/,
  );
});

test("concurrent unbounded downloads are cut off by the streaming wire budget", async () => {
  respond = fixture({
    [entry]: () =>
      html(
        `<script>for(let i=0;i<8;i++)fetch('https://cdn.example.org/large?i='+i).then(r=>r.text()).catch(()=>{});</script>`,
      ),
  });
  await assert.rejects(
    verifyReportNavigation(
      browser,
      share,
      {
        frames: [preview],
        entries: [entry, "https://cdn.example.org/missing.html"],
      },
      {
        timeoutMs: 3000,
        proxyOptions: { ...proxyOptions, maxBytes: 256 * 1024 },
      },
    ),
    (error) => error.cause?.code === "E_REPORT_DOWNLOAD_LIMIT",
  );
  for (let i = 0; streams.size && i < 100; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(streams.size, 0);
  assert.ok(streamBytes > 0 && streamBytes < 256 * 1024 + 1024 * 1024);
});

test("a rendered report may update its address without losing its loaded document", async () => {
  await check({
    [entry]: () =>
      html(
        `<script>history.replaceState(null,'','?lang=en')</script><main>Report</main>`,
      ),
  });
});

test("removing loader markers without writing the entry is still a delivery failure", async () => {
  await assert.rejects(
    check({
      [preview]: () =>
        html(
          loader.replace(
            "document.open();document.write(html);document.close();",
            "document.getElementById('artifact-delivery-config').remove();throw new Error('Delivery failed');",
          ),
        ),
    }),
    /Anonymous browser/,
  );
});

test(
  "a renderer-blocking report is stopped at the navigation deadline",
  { timeout: 6000 },
  async () => {
    const started = Date.now();
    await assert.rejects(
      check(
        { [entry]: () => html(`<script>while(true){}</script>`) },
        { timeoutMs: 1000 },
      ),
      /Anonymous browser/,
    );
    assert.ok(Date.now() - started < 4000);
    await check();
  },
);

test("a separate signed-in browser context cannot supply report credentials", async () => {
  const owner = await browser.newContext({
    extraHTTPHeaders: { Authorization: "Bearer test-only" },
  });
  await owner.addCookies([
    {
      name: "private-session",
      value: "test-only",
      domain: "reports.example.org",
      path: "/",
      secure: true,
    },
  ]);
  try {
    await check();
    assert.deepEqual(credentialViolations, []);
  } finally {
    await owner.close();
  }
});

test("a redirect chain ending at sign-in cannot count as report delivery", async () => {
  await assert.rejects(
    check({
      [entry]: () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.org/login" },
        }),
      ["https://cdn.example.org/login"]: () => html("<main>Sign in</main>"),
    }),
    /Anonymous browser/,
  );
});

test("a required iframe error document cannot be replaced by an unrelated successful fetch", async () => {
  const child = "https://reports.example.org/required.html";
  respond = fixture({
    [entry]: () => html(`<iframe src="${child}"></iframe>`),
    [child]: () =>
      new Response("Missing", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
  });
  await assert.rejects(
    verifyReportNavigation(
      browser,
      share,
      { frames: [preview, child], entries: [entry] },
      { proxyOptions, timeoutMs: 1500 },
    ),
    /Anonymous browser/,
  );
});

test("a successfully loaded required iframe that becomes blank loses its document evidence", async () => {
  const child = "https://reports.example.org/required.html";
  respond = fixture({
    [entry]: () => html(`<iframe src="${child}"></iframe>`),
    [child]: () => html(`<script>location.replace('about:blank')</script>`),
  });
  await assert.rejects(
    verifyReportNavigation(
      browser,
      share,
      { frames: [preview, child], entries: [entry] },
      { proxyOptions, timeoutMs: 1500 },
    ),
    /Anonymous browser/,
  );
});
