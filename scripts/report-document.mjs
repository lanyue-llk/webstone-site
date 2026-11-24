import { parse } from "parse5";
import { parentPort, workerData } from "node:worker_threads";

function reportDocument(html) {
  const document = parse(html);
  const stack = [{ node: document, depth: 0, inert: false, head: false }];
  const text = [];
  const frames = [];
  let deliveryConfig = null;
  let baseHref = null;
  let charset = null;
  let refresh = false;
  let nodes = 0;
  while (stack.length) {
    const { node, depth, inert: parentInert, head: parentHead } = stack.pop();
    if (++nodes > 100000 || depth > 256) throw new Error("Report document exceeds the HTML complexity limit");
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    const inert = parentInert || ["template", "noscript"].includes(node.tagName);
    const head = parentHead || node.tagName === "head";
    if (!inert) {
      if (node.tagName === "meta" && attrs["http-equiv"]?.toLowerCase() === "refresh") refresh = true;
      if (node.tagName === "base" && baseHref === null && attrs.href !== undefined) baseHref = attrs.href;
      if (node.tagName === "meta" && charset === null && (attrs.charset || attrs["http-equiv"]?.toLowerCase() === "content-type")) charset = attrs.charset ?? /charset\s*=\s*["']?([^;\s"']+)/i.exec(attrs.content ?? "")?.[1] ?? null;
      if (node.tagName === "script" && attrs.id === "artifact-delivery-config" && deliveryConfig === null) deliveryConfig = JSON.parse((node.childNodes ?? []).map(child => child.value ?? "").join(""));
      if (!head && node.tagName === "iframe") {
        const required = Object.hasOwn(attrs, "data-report-preview");
        if (required && !attrs.src?.trim() && attrs.srcdoc === undefined) throw new Error("Required report preview has no source");
        if (attrs.src || attrs.srcdoc !== undefined) frames.push({ src: attrs.src, srcdoc: attrs.srcdoc, required });
      }
      if (!head && node.nodeName === "#text") text.push(node.value);
    }
    if (["script", "style", "iframe"].includes(node.tagName)) continue;
    const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], depth: depth + 1, inert, head });
  }
  const content = text.join(" ").replace(/\s+/g, " ").trim();
  return { readable: Boolean(content) && !/^(?:loading[. …]*|please wait[. …]*|redirecting[. …]*)$/i.test(content), frames, deliveryConfig, baseHref, refresh, charset };
}

try { parentPort.postMessage({ document: reportDocument(workerData) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
