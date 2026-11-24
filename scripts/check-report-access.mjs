import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverResults, publicEvidenceUrl } from "./prepare-data.mjs";

const privateNetworks = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4]]) privateNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]]) privateNetworks.addSubnet(network, prefix, "ipv6");

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
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) req.destroy(new Error("Report exceeds the 20 MiB check limit"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          const body = [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status: response.statusCode, headers: response.headers }));
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function checkReportAccess(address, { request = anonymousRequest, resolve = lookup } = {}) {
  async function retrieve(address, json = false) {
    let url = new URL(address);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!publicEvidenceUrl(url.href)) throw new Error("Expected a public HTTPS URL without credentials");
      const records = await resolve(url.hostname, { all: true });
      if (!records.length || records.some(({ address }) => privateNetworks.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"))) throw new Error("URL resolves to a private or reserved network");
      if (/\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(url.pathname)) throw new Error("Report redirects to sign-in");
      const response = await request(url.href, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(20000), lookup: (_hostname, options, callback) => {
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
      const body = await response.text();
      if (!body.trim()) throw new Error("Report returned an empty document");
      const type = response.headers.get("content-type") ?? "";
      if (json) {
        if (!/application\/json/i.test(type)) throw new Error("Expected a report delivery manifest");
        return JSON.parse(body);
      }
      if (/application\/pdf/i.test(type) && body.startsWith("%PDF-")) return { url, body, pdf: true };
      if (!/text\/html/i.test(type)) throw new Error("Expected a readable HTML report or PDF");
      const visible = body.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const denied = visible.length < 4000 && /sign in to view this work|you are not signed in|sign in, then try opening|authentication required|需要登录|登录后.{0,8}(?:查看|访问)/i.test(visible);
      if (!visible.trim() && !/id=["\']artifact-delivery-config["\']/.test(body) && !/<iframe\b/i.test(body)) throw new Error("Report has no readable content");
      const denialHeading = /<(?:h[1-3]|title)\b[^>]*>\s*(?:Access denied|Forbidden|Authentication required|Sign in(?: to (?:view|continue|access)[^<]*)?|需要登录|请先登录|无权访问)\s*<\//i.test(body);
      if (denialHeading || denied || /<meta[^>]+Sign in to view this work/i.test(body) || /<input[^>]+type=["']password/i.test(body)) throw new Error("Anonymous reader received a sign-in or access-denied page");
      return { url, body, pdf: false, readable: Boolean(visible.trim()) };
    }
    throw new Error("Too many redirects");
  }

  async function validatePage(page, depth = 0) {
    if (page.pdf) return;
    if (depth > 5) throw new Error("Report contains too many nested previews");
    const configText = page.body.match(/<script[^>]+id=["']artifact-delivery-config["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (configText) {
      const config = JSON.parse(configText);
      const manifestUrl = new URL(config.manifestUrl);
      manifestUrl.searchParams.set("file", config.file);
      let entry;
      for (let index = 0; index < 20; index++) {
        const manifest = await retrieve(manifestUrl.href, true);
        entry = manifest.files?.find(file => file.path === config.file);
        if (entry || manifest.nextCursor === null || manifest.nextCursor === undefined) break;
        manifestUrl.searchParams.set("cursor", String(manifest.nextCursor));
      }
      if (!entry?.url) throw new Error("Report entry is missing from the anonymous delivery manifest");
      await validatePage(await retrieve(entry.url), depth + 1);
      return;
    }
    const hosted = /\/artifact-site\/(s|v)\//.test(page.url.pathname);
    if (hosted || !page.readable) {
      const source = page.body.match(/<iframe\b[^>]*\bsrc=["']([^"']+)/i)?.[1];
      if (!source) throw new Error("Hosted report has no readable preview");
      await validatePage(await retrieve(new URL(source.replaceAll("&amp;", "&"), page.url).href), depth + 1);
    }
  }
  await validatePage(await retrieve(address));
}

async function main() {
  const root = new URL("../", import.meta.url);
  const catalog = JSON.parse(await readFile(new URL("benchmarks/catalog.json", root), "utf8"));
  const files = await discoverResults(fileURLToPath(new URL("results/", root)), catalog);
  const metadata = JSON.parse(await readFile(new URL("reports/metadata.json", root), "utf8"));
  const links = reportLinks(catalog, files.map(item => item.report), metadata);
  const failures = [];
  await Promise.all(links.map(async link => {
    try { await checkReportAccess(link); console.log(`Anonymous report access OK: ${link}`); }
    catch (error) { failures.push(`${link}: ${error.message}`); }
  }));
  if (failures.length) throw new Error(failures.join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => { console.error(error.message); process.exitCode = 1; });
