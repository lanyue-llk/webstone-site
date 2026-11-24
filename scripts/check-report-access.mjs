import { parse } from "parse5";
import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { createHash } from "node:crypto";
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
      let wireSize = 0;
      let size = 0;
      const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase().trim();
      const decoders = { gzip: createGunzip, br: createBrotliDecompress, deflate: createInflate };
      if (encoding !== "identity" && !Object.hasOwn(decoders, encoding)) {
        reject(new Error("Unsupported report content encoding"));
        req.destroy();
        return;
      }
      const decoded = encoding === "identity" ? response : response.pipe(decoders[encoding]());
      response.on("data", chunk => {
        wireSize += chunk.length;
        if (wireSize > 20 * 1024 * 1024) req.destroy(new Error("Report exceeds the 20 MiB check limit"));
      });
      decoded.on("data", chunk => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          const error = new Error("Decoded report exceeds the 20 MiB check limit");
          reject(error); req.destroy(error); if (decoded !== response) decoded.destroy(error);
        } else chunks.push(chunk);
      });
      response.on("error", reject);
      decoded.on("error", reject);
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
  const document = parse(html);
  const text = [];
  const frames = [];
  const blocks = [];
  let deliveryConfig = null;
  let baseHref = null;
  let password = false;
  let deniedMeta = false;
  let refresh = false;
  const attributes = node => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
  function hidden(node) {
    const attrs = attributes(node);
    return ["template", "style", "noscript"].includes(node.tagName) || Object.hasOwn(attrs, "hidden")
      || attrs["aria-hidden"] === "true" || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? "")
      || (node.tagName === "dialog" && !Object.hasOwn(attrs, "open"));
  }
  const summaries = new Map();
  const stack = [{ node: document, depth: 0, inHead: false, inNavigation: false }];
  let nodes = 0;
  while (stack.length) {
    const { node, depth, inHead: parentHead, inNavigation: parentNavigation, exit = false } = stack.pop();
    if (exit) {
      const parts = (node.childNodes ?? []).map(child => summaries.get(child) ?? { plain: "", all: "" });
      const normalize = value => value.replace(/\s+/g, " ").trim().slice(0, 512);
      const all = normalize(parts.map(part => part.all).join(" "));
      const plain = normalize(parts.map(part => part.plain).join(" "));
      summaries.set(node, { all, plain: parentNavigation ? "" : plain });
      if (!parentHead && ["body", "main", "article", "section", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "label", "form", "dialog", "a", "button", "summary"].includes(node.tagName)) {
        if (!parentNavigation && plain) blocks.push(plain);
        if (parentNavigation && /^(?:please )?(?:sign in|log in|login).*(?:to (?:view|access|continue)|required)/i.test(all)) blocks.push(all);
      }
      for (const child of node.childNodes ?? []) summaries.delete(child);
      continue;
    }
    if (++nodes > 100000 || depth > 256) throw new Error("Report document exceeds the HTML complexity limit");
    if (hidden(node)) continue;
    const attrs = attributes(node);
    if (node.tagName === "meta" && attrs["http-equiv"]?.toLowerCase() === "refresh") refresh = true;
    if (node.tagName === "base" && baseHref === null && attrs.href !== undefined) baseHref = attrs.href;
    if (node.tagName === "meta" && /sign in to view this work/i.test(attrs.content ?? "")) deniedMeta = true;
    if (node.tagName === "script") {
      if (attrs.id === "artifact-delivery-config") deliveryConfig = JSON.parse((node.childNodes ?? []).map(node => node.value ?? "").join(""));
      continue;
    }
    const inHead = parentHead || node.tagName === "head";
    const inNavigation = parentNavigation || ["nav", "a", "button", "summary"].includes(node.tagName);
    if (!inHead && !inNavigation) {
      if (node.nodeName === "#text") {
        const value = node.value.replace(/\s+/g, " ").trim();
        text.push(value);

      }
      if (node.tagName === "iframe" && (attrs.src || attrs.srcdoc !== undefined)) frames.push({ src: attrs.src, srcdoc: attrs.srcdoc });
      if (node.tagName === "input" && attrs.type?.toLowerCase() === "password") password = true;
    }
    if (node.nodeName === "#text") summaries.set(node, { all: node.value.slice(0, 512), plain: inNavigation || inHead ? "" : node.value.slice(0, 512) });
    else stack.push({ node, depth, inHead, inNavigation, exit: true });
    const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], depth: depth + 1, inHead, inNavigation });
  }
  const visible = text.join(" ").replace(/\s+/g, " ").trim();
  const gate = /^(?:access denied|forbidden|authentication required|you are not signed in[.!]?|(?:please )?(?:sign in|log in|login)(?: required| to (?:view|continue|access)[^.]*)?[.!]?|sign in, then try opening[^.]*[.!]?|需要登录[。！]?|请先登录[。！]?|无权访问[。！]?|登录后.{0,8}(?:查看|访问)[。！]?)$/i;
  return { readable: Boolean(visible) && !/^(?:loading[. …]*|please wait[. …]*|redirecting[. …]*|正在加载[. …]*)$/i.test(visible), frames, deliveryConfig, baseHref, refresh, denied: password || deniedMeta || blocks.some(block => gate.test(block)) || gate.test(visible) };
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
  const validated = new Set();
  const active = new Set();
  async function retrieve(address, json = false) {
    let url = new URL(address);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!publicEvidenceUrl(url.href)) throw new Error("Expected a public HTTPS URL without credentials");
      if (++requests > 40 || Date.now() >= deadline) throw new Error("Report exceeds the request or time budget");
      const records = await bounded(resolve(url.hostname, { all: true }));
      if (Date.now() >= deadline) throw new Error("Report exceeds the time budget");
      if (!records.length || records.some(({ address }) => privateNetworks.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"))) throw new Error("URL resolves to a private or reserved network");
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
      const body = await response.text();
      if (!body.trim()) throw new Error("Report returned an empty document");
      const type = response.headers.get("content-type") ?? "";
      if (json) {
        if (!/application\/json/i.test(type)) throw new Error("Expected a report delivery manifest");
        return JSON.parse(body);
      }
      if (/application\/pdf/i.test(type) && body.startsWith("%PDF-")) return { url, body, pdf: true };
      if (!/text\/html/i.test(type)) throw new Error("Expected a readable HTML report or PDF");
      const document = reportDocument(body);
      if (document.refresh) throw new Error("Report uses HTML refresh; provide its final public URL");
      if (document.denied) throw new Error("Anonymous reader received a sign-in or access-denied page");
      if (!document.readable && !document.frames.length && !document.deliveryConfig) throw new Error("Report has no readable content");
      return { url, body, pdf: false, ...document };
    }
    throw new Error("Too many redirects");
  }

  async function validatePage(page, depth = 0) {
    if (Date.now() >= deadline) throw new Error("Report exceeds the time budget");
    const identity = page.url.href + (page.inline ? "#inline-" + createHash("sha256").update(page.body).digest("hex") : "");
    if (active.has(identity)) throw new Error("Report contains a cyclic preview chain");
    if (validated.has(identity)) return;
    active.add(identity);
    try { await validatePageContent(page, depth); validated.add(identity); }
    finally { active.delete(identity); }
  }

  async function validatePageContent(page, depth) {
    if (page.pdf) return;
    if (depth > 5) throw new Error("Report contains too many nested previews");
    if (page.deliveryConfig) {
      const config = page.deliveryConfig;
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
    const sources = page.frames;
    if (!sources.length && (!page.inline && /\/artifact-site\/(s|v)\//.test(page.url.pathname) || !page.readable)) throw new Error("Hosted report has no readable preview");
    const base = page.baseHref === null ? page.url : new URL(page.baseHref, page.url);
    const destinations = new Set();
    for (const frame of sources) {
      const destination = frame.srcdoc !== undefined ? frame.srcdoc : new URL(frame.src, base).href;
      if (destinations.has(destination)) continue;
      destinations.add(destination);
      if (frame.srcdoc !== undefined) {
        const inline = reportDocument(frame.srcdoc);
        if (inline.refresh || inline.denied) throw new Error("Inline report requires sign-in or redirects");
        if (!inline.readable && !inline.frames.length && !inline.deliveryConfig) throw new Error("Inline report has no readable content");
        await validatePage({ url: base, body: frame.srcdoc, pdf: false, ...inline, inline: true }, depth + 1);
      } else await validatePage(await retrieve(new URL(frame.src, base).href), depth + 1);
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
