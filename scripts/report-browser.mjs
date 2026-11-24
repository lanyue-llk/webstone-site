import { chromium } from "playwright";
import { createPublicBrowserProxy } from "./public-browser-proxy.mjs";
import { publicEvidenceUrl } from "./prepare-data.mjs";

export function launchReportBrowser({ args = [] } = {}) {
  return chromium.launch({
    ...(process.env.REPORT_BROWSER_CHANNEL
      ? { channel: process.env.REPORT_BROWSER_CHANNEL }
      : {}),
    headless: true,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", ...args],
  });
}

export function reportDestination(value) {
  const url = new URL(value);
  url.hash = "";
  const cos = /\.cos\.[a-z0-9-]+\.myqcloud\.com$/i.test(url.hostname);
  const s3 = /(?:^|\.)s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?$/i.test(
    url.hostname,
  );
  const cosKeys = new Set([
    "q-sign-algorithm",
    "q-ak",
    "q-sign-time",
    "q-key-time",
    "q-header-list",
    "q-url-param-list",
    "q-signature",
    "x-cos-security-token",
  ]);
  const s3Keys = new Set([
    "x-amz-algorithm",
    "x-amz-content-sha256",
    "x-amz-credential",
    "x-amz-date",
    "x-amz-expires",
    "x-amz-signedheaders",
    "x-amz-signature",
    "x-amz-security-token",
  ]);
  for (const key of [...url.searchParams.keys()])
    if (
      (cos && cosKeys.has(key.toLowerCase())) ||
      ((s3 || cos) && s3Keys.has(key.toLowerCase()))
    )
      url.searchParams.delete(key);
  return url.href;
}

export async function verifyReportNavigation(
  browser,
  address,
  delivery,
  { timeoutMs = 30000, proxyOptions = {} } = {},
) {
  const proxy = await createPublicBrowserProxy({ timeoutMs, ...proxyOptions });
  let context;
  const deadline = Date.now() + timeoutMs;
  const observed = new Set();
  const frameDocuments = new Map();
  const renderedFrames = new Set();
  try {
    context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      proxy: { server: proxy.server },
    });
    await context.exposeBinding("__webstoneReportDelivered", ({ frame }) =>
      renderedFrames.add(frame),
    );
    await context.addInitScript(() => {
      const close = Document.prototype.close;
      Document.prototype.close = function (...args) {
        const result = Reflect.apply(close, this, args);
        if (this === document)
          window.__webstoneReportDelivered().catch(() => {});
        return result;
      };
    });
    context.on("request", (request) => {
      if (request.isNavigationRequest()) {
        frameDocuments.delete(request.frame());
        renderedFrames.delete(request.frame());
      }
    });
    context.on("page", (page) =>
      page.on("framenavigated", (frame) => {
        if (!frame.url().startsWith("https://")) {
          frameDocuments.delete(frame);
          renderedFrames.delete(frame);
        }
      }),
    );
    context.on("requestfinished", async (request) => {
      try {
        const response = await request.response();
        if (!response?.ok()) return;
        const chain = [];
        for (let current = request; current; current = current.redirectedFrom())
          chain.push(reportDestination(current.url()));
        if (
          chain.some(
            (value) =>
              !publicEvidenceUrl(value) ||
              /\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
                decodeURIComponent(new URL(value).pathname),
              ),
          )
        )
          return;
        if (request.isNavigationRequest())
          frameDocuments.set(request.frame(), chain);
        for (const url of chain) observed.add(url);
      } catch {
        /* Optional requests can finish while their context closes. */
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    let requests = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (
          !publicEvidenceUrl(url.href) ||
          /\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
            decodeURIComponent(url.pathname),
          ) ||
          ["image", "font", "media"].includes(request.resourceType()) ||
          !["GET", "HEAD"].includes(request.method())
        )
          return await route.abort();
        if (++requests > 200) return await route.abort();
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    await page.goto(address, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const required = delivery.entries.map(reportDestination);
    const frames = delivery.frames.map(reportDestination);
    while (Date.now() < deadline) {
      if (proxy.failure) throw proxy.failure;
      const loadedFrames = new Set(
        page.frames().flatMap((frame) => frameDocuments.get(frame) ?? []),
      );
      if (
        required.every((url) => observed.has(url)) &&
        frames.every((url) => loadedFrames.has(url))
      ) {
        if (proxy.failure) throw proxy.failure;
        const previews = frames.filter((url) =>
          /\/api\/preview\//.test(new URL(url).pathname),
        );
        if (
          previews.every((url) =>
            page
              .frames()
              .some(
                (frame) =>
                  renderedFrames.has(frame) &&
                  frameDocuments.get(frame)?.includes(url),
              ),
          )
        )
          return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      "Anonymous browser could not load the report preview and delivery",
    );
  } catch {
    throw new Error(
      "Anonymous browser could not open the report preview and delivery",
      {
        cause: { code: proxy.failure?.code ?? "E_REPORT_NAVIGATION" },
      },
    );
  } finally {
    await context?.close();
    await proxy.close();
  }
}
