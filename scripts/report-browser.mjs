import { chromium } from "playwright";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  anonymousRequest,
  isPublicNetworkAddress,
} from "./check-report-access.mjs";
import { publicEvidenceUrl } from "./prepare-data.mjs";

export function launchReportBrowser() {
  return chromium.launch({
    ...(process.env.REPORT_BROWSER_CHANNEL
      ? { channel: process.env.REPORT_BROWSER_CHANNEL }
      : {}),
    headless: true,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND"],
  });
}

const destination = (value) => {
  const url = new URL(value);
  return url.origin + url.pathname;
};

export async function verifyReportNavigation(
  browser,
  address,
  delivery,
  { resolve = lookup, request = anonymousRequest, timeoutMs = 30000 } = {},
) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const observed = new Set();
  const aliases = new Map();
  context.on("requestfinished", async (incoming) => {
    try {
      const response = await incoming.response();
      if (response?.ok())
        for (const url of aliases.get(incoming) ?? []) observed.add(url);
    } catch {
      /* A context can close while an optional request finishes. */
    }
  });
  let calls = 0,
    bytes = 0;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      try {
        const incoming = route.request();
        if (
          ["image", "font", "media"].includes(incoming.resourceType()) ||
          !["GET", "HEAD"].includes(incoming.method())
        )
          return await route.abort();
        let url = new URL(incoming.url());
        const originalOrigin = url.origin;
        if (
          !publicEvidenceUrl(url.href) ||
          /\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
            decodeURIComponent(url.pathname),
          )
        )
          throw new Error("Navigation requires a public URL without sign-in");
        controller.signal.throwIfAborted();
        let onAbort;
        let records;
        try {
          records = await Promise.race([
            resolve(url.hostname, { all: true }),
            new Promise((_, reject) => {
              onAbort = () => reject(new Error("Navigation cancelled"));
              controller.signal.addEventListener("abort", onAbort, {
                once: true,
              });
            }),
          ]);
        } finally {
          controller.signal.removeEventListener("abort", onAbort);
        }
        controller.signal.throwIfAborted();
        if (
          !records.length ||
          records.some((record) => !isPublicNetworkAddress(record.address))
        )
          throw new Error(
            "Navigation resolves to a private or reserved network",
          );
        let response;
        for (let redirects = 0; redirects <= 5; redirects++) {
          if (++calls > 200 || Date.now() >= deadline)
            throw new Error("Report navigation exceeds its budget");
          if (
            url.origin !== originalOrigin ||
            !publicEvidenceUrl(url.href) ||
            /\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
              decodeURIComponent(url.pathname),
            )
          )
            throw new Error(
              "Use a canonical share URL without cross-origin or sign-in redirects",
            );
          response = await request(url.href, {
            credentials: "omit",
            redirect: "manual",
            signal: controller.signal,
            origin: incoming.headers().origin,
            lookup: (_host, options, callback) => {
              const pinned = records.map((record) => ({
                address: record.address,
                family: isIP(record.address),
              }));
              if (options.all) callback(null, pinned);
              else callback(null, pinned[0].address, pinned[0].family);
            },
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          if (!response.headers.get("location") || redirects === 5)
            throw new Error("Invalid report navigation redirect");
          url = new URL(response.headers.get("location"), url);
        }
        const body = Buffer.from(await response.arrayBuffer());
        bytes += body.length;
        if (bytes > 100 * 1024 * 1024)
          throw new Error("Report navigation exceeds its download budget");
        aliases.set(incoming, [
          destination(incoming.url()),
          destination(url.href),
        ]);
        const headers = Object.fromEntries(response.headers);
        // Playwright otherwise supplies a permissive CORS header for mocked responses.
        if (
          incoming.headers().origin &&
          !response.headers.has("access-control-allow-origin")
        )
          headers["access-control-allow-origin"] = "";
        await route.fulfill({ status: response.status, headers, body });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    await page.goto(address, { waitUntil: "networkidle", timeout: timeoutMs });
    const required = delivery.entries.map(destination);
    const frames = delivery.frames.map(destination);
    while (Date.now() < deadline) {
      const loadedFrames = new Set(
        page.frames().map((frame) => {
          try {
            return destination(frame.url());
          } catch {
            return "";
          }
        }),
      );
      if (
        required.every((url) => observed.has(url)) &&
        frames.every((url) => loadedFrames.has(url))
      ) {
        await page.waitForLoadState("networkidle", {
          timeout: Math.max(1, deadline - Date.now()),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      "Anonymous browser could not load the report preview and delivery",
    );
  } catch (error) {
    throw new Error(
      error.message.startsWith("Anonymous browser")
        ? error.message
        : "Anonymous browser could not open the report",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    await context.close();
  }
}
