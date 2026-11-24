import { Worker } from "node:worker_threads";
import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverResults, publicEvidenceUrl } from "./prepare-data.mjs";

const privateNetworks = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) privateNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) privateNetworks.addSubnet(network, prefix, "ipv6");
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

export function reportLinks(catalog, snapshots, metadata) {
  return [...new Set([
    ...catalog.benchmarks.map(benchmark => benchmark.reportUrl),
    ...Object.entries(metadata.reports).flatMap(([id, report]) => [
      ...Object.values(report.urls ?? {}).filter(Boolean),
      ...(report.versionReport ? snapshots.find(snapshot => snapshot.id === id)?.benchmarks.map(benchmark => benchmark.reportUrl) ?? [] : []),
    ]),
  ].filter(Boolean))];
}

export function anonymousRequest(address, options, transport = httpsRequest) {
  return new Promise((resolve, reject) => {
    const req = transport(address, { lookup: options.lookup, signal: options.signal }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        resolve(new Response(null, { status: response.statusCode, headers: response.headers }));
        response.on("error", () => {});
        response.destroy?.();
        return;
      }
      const chunks = [];
      let wireSize = 0;
      let size = 0;
      const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase().trim();
      const decoders = { gzip: createGunzip, br: createBrotliDecompress, deflate: createInflate };
      if (encoding !== "identity" && !Object.hasOwn(decoders, encoding)) {
        reject(new Error("Unsupported report content encoding"));
        response.destroy(); req.destroy();
        return;
      }
      const decoded = encoding === "identity" ? response : response.pipe(decoders[encoding]());
      let failed = false;
      function fail(error) {
        if (failed) return;
        failed = true; reject(error);
        response.destroy(error);
        if (decoded !== response) decoded.destroy(error);
        req.destroy(error);
      }
      response.on("data", chunk => {
        wireSize += chunk.length;
        if (wireSize > 20 * 1024 * 1024) fail(new Error("Report exceeds the 20 MiB check limit"));
      });
      decoded.on("data", chunk => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          const error = new Error("Decoded report exceeds the 20 MiB check limit");
          fail(error);
        } else chunks.push(chunk);
      });
      response.on("error", fail);
      decoded.on("error", fail);
      decoded.on("end", () => {
        try {
          const body = [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks);
          const headers = { ...response.headers };
          delete headers["content-encoding"]; delete headers["content-length"];
          resolve(new Response(body, { status: response.statusCode, headers }));
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function reportDocument(html) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./report-document.mjs", import.meta.url), {
      workerData: html,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Report document exceeds the HTML complexity time limit")); }, 5000);
    worker.once("message", result => {
      clearTimeout(timer);
      worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve(result.document);
    });
    worker.once("error", () => { clearTimeout(timer); reject(new Error("Report document exceeds the HTML complexity resource limit")); });
    worker.once("exit", () => { clearTimeout(timer); reject(new Error("Report document stopped before returning readable content")); });
  });
}

export async function checkReportAccess(address, { request = anonymousRequest, resolve = lookup, timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + Math.min(timeoutMs, 60000);
  async function bounded(promise) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Report exceeds the time budget")), Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  let requests = 0;
  async function retrieve(address, kind = "html") {
    let url = new URL(address);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!publicEvidenceUrl(url.href)) throw new Error("Expected a public HTTPS URL without credentials");
      if (++requests > 40 || Date.now() >= deadline) throw new Error("Report exceeds the request or time budget");
      const records = await bounded(resolve(url.hostname, { all: true }));
      if (Date.now() >= deadline) throw new Error("Report exceeds the time budget");
      if (!records.length || records.some(({ address }) => !isIP(address) || (isIP(address) === 6 && !globalIPv6.check(address, "ipv6")) || privateNetworks.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"))) throw new Error("URL resolves to a private or reserved network");
      if (/\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(url.pathname)) throw new Error("Report redirects to sign-in");
      const response = await request(url.href, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))), lookup: (_hostname, options, callback) => {
        const pinned = records.map(record => ({ address: record.address, family: isIP(record.address) }));
        if (options.all) callback(null, pinned);
        else callback(null, pinned[0].address, pinned[0].family);
      } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect has no destination");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`Anonymous request returned HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      const encoding = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1];
      if (encoding && !/^(?:utf-?8|us-ascii)$/i.test(encoding)) throw new Error("Reports must use UTF-8 encoding");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (kind === "entry") {
        return { url, bytes, type, headers: response.headers };
      }
      if (!bytes.length) throw new Error("Report returned an empty document");
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!body.trim()) throw new Error("Report returned an empty document");
      if (kind === "json") {
        if (!/application\/json/i.test(type)) throw new Error("Expected a report delivery manifest");
        return JSON.parse(body);
      }
      if (/application\/pdf/i.test(type)) throw new Error("PDF reports require a separate anonymous-readability check; publish a readable HTML report");
      if (!/text\/html/i.test(type)) throw new Error("Expected a readable HTML report");
      const document = await bounded(reportDocument(body));
      if (document.charset && !/^(?:utf-?8|us-ascii)$/i.test(document.charset)) throw new Error("Reports must use UTF-8 encoding");
      if (document.refresh) throw new Error("Report uses HTML refresh; provide its final public URL");

      return { url, headers: response.headers, ...document };
    }
    throw new Error("Too many redirects");
  }

  const active = new Set(), checked = new Set();
  async function visit(kind, url, depth, work, context = "") {
    if (depth > 5) throw new Error("Report contains too many nested previews");
    const key = kind + ":" + url;
    if (active.has(key)) throw new Error("Report contains a cyclic preview");
    const completedKey = key + ":" + context;
    if (checked.has(completedKey)) return;
    active.add(key);
    try { await work(); checked.add(completedKey); } finally { active.delete(key); }
  }
  function embeddingAllowed(headers, url, ancestors) {
    if (!ancestors.length) return;
    const directives = (headers.get("content-security-policy") ?? "").split(",").map(policy => policy.split(";").map(value => value.trim().split(/\s+/)).find(parts => parts[0]?.toLowerCase() === "frame-ancestors")).filter(Boolean);
    const schemeMatches = (source, target) => source === target || source === "http:" && target === "https:" || source === "ws:" && ["wss:", "http:", "https:"].includes(target) || source === "wss:" && target === "https:";
    function matches(source, ancestor) {
      if (source.toLowerCase() === "'self'") return ancestor === url.origin;
      if (source === "*") return true;
      if (source === "'none'" || source.includes("'")) return false;
      const parent = new URL(ancestor);
      if (/^[a-z][a-z\d+.-]*:$/i.test(source)) return schemeMatches(source.toLowerCase(), parent.protocol);
      try {
        const wildcardHost = /^(?:[a-z][a-z\d+.-]*:\/\/)?\*\./i.test(source);
        const wildcardPort = /:\*(?:\/|$)/.test(source);
        const port = /:(\d+)(?:\/|$)/.exec(source)?.[1];
        const candidate = source.replace(/(^|\/\/)\*\./, "$1").replace(/:\*(?=\/|$)/, "");
        const target = new URL(candidate.includes("://") ? candidate : url.protocol + "//" + candidate);
        if (target.username || target.password || target.search || target.hash) return false;
        if (!schemeMatches(target.protocol, parent.protocol)) return false;
        if (isIP(target.hostname.replace(/^\[|\]$/g, ""))) return false;
        if (target.hostname !== "*" && (wildcardHost ? !parent.hostname.endsWith("." + target.hostname) : parent.hostname !== target.hostname)) return false;
        const parentPort = parent.port || "443";
        if (!wildcardPort && (port ? Number(port) !== Number(parentPort) : parent.port !== "")) return false;
        return target.pathname === "/";
      } catch { return false; }
    }
    if (directives.length) {
      if (directives.some(parts => ancestors.some(ancestor => !parts.slice(1).some(source => matches(source, ancestor))))) throw new Error("Report preview blocks embedding in its public share");
      return;
    }
    const options = (headers.get("x-frame-options") ?? "").toLowerCase().split(",").map(value => value.trim());
    if (options.includes("deny") || options.includes("sameorigin") && ancestors.some(ancestor => ancestor !== url.origin)) throw new Error("Report preview blocks embedding in its public share");
  }
  async function embedded(document, base, depth, serviceOrigin = new URL(base).origin, rendering = { origin: serviceOrigin, ancestors: [] }) {
    if (depth > 5) throw new Error("Report contains too many nested previews");
    if (document.refresh) throw new Error("Report uses HTML refresh; provide its final public URL");
    if (document.charset && !/^(?:utf-?8|us-ascii)$/i.test(document.charset)) throw new Error("Reports must use UTF-8 encoding");
    const origin = serviceOrigin;
    const documentBase = document.baseHref === null ? base : new URL(document.baseHref, base);
    const ancestors = [...rendering.ancestors, rendering.origin];
    for (const frame of document.frames) {
      if (frame.srcdoc !== undefined) {
        await embedded(await bounded(reportDocument(frame.srcdoc)), documentBase, depth + 1, origin, { origin: rendering.origin, ancestors });
        continue;
      }
      const url = new URL(frame.src, documentBase);
      const firstParty = url.origin === origin;
      if (firstParty && /\/api\/preview\//.test(url.pathname)) await preview(url.href, depth + 1, ancestors);
      else if (firstParty && /\/(?:s|v)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) await share(url.href, depth + 1, ancestors);
      else if (frame.required) await resource(url.href, origin, depth + 1, { direct: true, ancestors });
    }
  }
  async function resource(url, serviceOrigin, depth, rendering) {
    await visit("entry", url, depth, async () => {
      // Yours serves the owner's uploaded file directly after the public manifest.
      // This gate checks anonymous delivery, not the report's prose, examples or forms.
      const response = await retrieve(url, "entry");
      if (rendering.direct) {
        embeddingAllowed(response.headers, response.url, rendering.ancestors);
        rendering = { origin: response.url.origin, ancestors: rendering.ancestors };
      }
      if (!/text\/html/i.test(response.type)) throw new Error("Expected an HTML report entry");
      if (/text\/html/i.test(response.type)) {
        const html = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
        const document = await bounded(reportDocument(html));
        if (document.charset && !/^(?:utf-?8|us-ascii)$/i.test(document.charset)) throw new Error("Reports must use UTF-8 encoding");
        if (document.refresh) throw new Error("Report uses HTML refresh; provide its final public URL");
        await embedded(document, response.url, depth, serviceOrigin, rendering);
      }
    }, JSON.stringify([serviceOrigin, rendering]));
  }
  async function preview(url, depth, ancestors) {
    await visit("preview", url, depth, async () => {
      const page = await retrieve(url);
      embeddingAllowed(page.headers, page.url, ancestors);
      const config = page.deliveryConfig;
      if (!config || typeof config.file !== "string" || !config.file) throw new Error("Anonymous preview did not expose its report delivery manifest");
      const manifestUrl = new URL(config.manifestUrl, page.url);
      manifestUrl.searchParams.set("file", config.file);
      let entry;
      for (let index = 0; index < 20; index++) {
        const manifest = await retrieve(manifestUrl.href, "json");
        if (!Array.isArray(manifest.files) || manifest.files.some(file => !file || typeof file.path !== "string" || typeof file.url !== "string")) throw new Error("Invalid report delivery manifest");
        entry = manifest.files.find(file => file.path === config.file);
        if (entry || manifest.nextCursor === null || manifest.nextCursor === undefined) break;
        manifestUrl.searchParams.set("cursor", String(manifest.nextCursor));
      }
      if (!entry?.url) throw new Error("Report entry is missing from the anonymous delivery manifest");
      const rendering = { origin: page.url.origin, ancestors };
      await resource(entry.url, page.url.origin, depth, rendering);
      await embedded(page, page.url, depth, page.url.origin, rendering);
    }, JSON.stringify(ancestors));
  }
  async function share(url, depth, ancestors = []) {
    await visit("share", url, depth, async () => {
      const page = await retrieve(url);
      embeddingAllowed(page.headers, page.url, ancestors);
      const match = /^(.*)\/(s|v)\/([A-Za-z0-9_-]+)\/?$/.exec(page.url.pathname);
      if (!match) throw new Error("Use the report service's public share URL");
      const base = page.baseHref === null ? page.url : new URL(page.baseHref, page.url);
      const prefix = match[1] + "/api/preview/";
      const previews = page.frames.flatMap(frame => {
        if (!frame.src || frame.srcdoc !== undefined) return [];
        const target = new URL(frame.src, base);
        return target.origin === page.url.origin && (match[2] === "v" ? target.pathname.startsWith(prefix) : target.pathname.startsWith(prefix + match[3] + "/") || target.pathname === prefix + match[3]) ? [target] : [];
      });
      if (!previews.length) throw new Error("Public share has no report-service preview");
      for (const target of previews) await preview(target.href, depth, [...ancestors, page.url.origin]);
      const otherFrames = page.frames.filter(frame => frame.srcdoc !== undefined || !previews.some(target => target.href === new URL(frame.src, base).href));
      await embedded({ ...page, frames: otherFrames }, page.url, depth, page.url.origin, { origin: page.url.origin, ancestors });
    }, JSON.stringify(ancestors));
  }
  await share(address, 0);
}

async function main() {
  const root = new URL("../", import.meta.url);
  const catalog = JSON.parse(await readFile(new URL("benchmarks/catalog.json", root), "utf8"));
  const files = await discoverResults(fileURLToPath(new URL("results/", root)), catalog);
  const metadata = JSON.parse(await readFile(new URL("reports/metadata.json", root), "utf8"));
  const links = reportLinks(catalog, files.map(item => item.report), metadata);
  const failures = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, links.length) }, async () => {
    while (next < links.length) {
      const link = links[next++];
      try { await checkReportAccess(link); console.log(`Anonymous report access OK: ${link}`); }
      catch (error) { failures.push(`${link}: ${error.message}`); }
    }
  }));
  if (failures.length) throw new Error(failures.join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => { console.error(error.message); process.exitCode = 1; });
