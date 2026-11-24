import { Worker } from "node:worker_threads";
import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { createHash } from "node:crypto";
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

const reviewedPublications = JSON.parse(await readFile(new URL("../reports/publications.json", import.meta.url), "utf8"));

export function validatePublication(publication, depth = 0, ancestors = new Set()) {
  if (!publication || typeof publication !== "object" || ancestors.has(publication) || depth > 5) throw new Error("Missing or cyclic reviewed report publication");
  if (!/^ver_[A-Za-z0-9_]+$/.test(publication.versionId ?? "") || !/^[a-f0-9]{64}$/.test(publication.entry?.sha256 ?? "")) throw new Error("Reviewed report needs its immutable version and SHA-256");
  const path = publication.entry?.path;
  if (typeof path !== "string" || /[\\?#%\u0000-\u001f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe reviewed report entry path");
  if (publication.dependencies !== undefined && !Array.isArray(publication.dependencies)) throw new Error("Invalid reviewed report dependencies");
  ancestors.add(publication);
  for (const dependency of publication.dependencies ?? []) {
    if (!publicEvidenceUrl(dependency.url)) throw new Error("Expected a public report dependency URL");
    validatePublication(dependency, depth + 1, ancestors);
  }
  ancestors.delete(publication);
}

export async function checkReportAccess(address, { publication = reviewedPublications[address], request = anonymousRequest, resolve = lookup, timeoutMs = 60000 } = {}) {
  validatePublication(publication);
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
      if (!bytes.length) throw new Error("Report returned an empty document");
      if (kind === "entry") {
        if (!/text\/html/i.test(type)) throw new Error("Expected a reviewed HTML report entry");
        return bytes;
      }
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

      return { url, ...document };
    }
    throw new Error("Too many redirects");
  }

  async function checkPublication(url, expected) {
    const root = await retrieve(url);
    const share = /^(.*)\/(s|v)\/([A-Za-z0-9_-]+)\/?$/.exec(root.url.pathname);
    if (!share) throw new Error("Use the report service's public share URL");
    const base = root.baseHref === null ? root.url : new URL(root.baseHref, root.url);
    const prefix = share[1] + "/api/preview/";
    const previews = root.frames.flatMap(frame => {
      if (!frame.src || frame.srcdoc !== undefined) return [];
      const target = new URL(frame.src, base);
      return target.origin === root.url.origin && (share[2] === "v" ? target.pathname.startsWith(prefix) : target.pathname.startsWith(prefix + share[3] + "/") || target.pathname === prefix + share[3]) ? [target] : [];
    });
    if (!previews.length) throw new Error("Public share has no report-service preview");
    if (root.frames.some(frame => frame.required && !previews.some(url => frame.src && new URL(frame.src, base).href === url.href))) throw new Error("Share contains an unreviewed required preview");
    for (const target of previews) {
      const slug = target.pathname.slice(prefix.length).split("/")[0];
      target.pathname = prefix + slug + "/" + expected.entry.path.split("/").map(encodeURIComponent).join("/");
      const preview = await retrieve(target.href);
      const config = preview.deliveryConfig;
      if (!config || config.file !== expected.entry.path) throw new Error("Anonymous preview did not expose the reviewed report entry");
      const manifestUrl = new URL(config.manifestUrl);
      manifestUrl.searchParams.set("file", config.file);
      let entry;
      for (let index = 0; index < 20; index++) {
        const manifest = await retrieve(manifestUrl.href, "json");
        if (manifest.versionId !== expected.versionId) throw new Error("Report publication changed; review the new edition and update reports/publications.json");
        if (!Array.isArray(manifest.files)) throw new Error("Invalid report delivery manifest");
        entry = manifest.files.find(file => file.path === config.file);
        if (entry || manifest.nextCursor == null) break;
        manifestUrl.searchParams.set("cursor", String(manifest.nextCursor));
      }
      if (!entry?.url) throw new Error("Reviewed report entry is missing from the anonymous delivery manifest");
      const bytes = await retrieve(entry.url, "entry");
      if (createHash("sha256").update(bytes).digest("hex") !== expected.entry.sha256) throw new Error("Reviewed report entry has changed");
    }
    for (const dependency of expected.dependencies ?? []) await checkPublication(dependency.url, dependency);
  }
  await checkPublication(address, publication);
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
