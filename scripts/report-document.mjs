import { parse } from "parse5";
import { parentPort, workerData } from "node:worker_threads";

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
    const children = node.tagName === "details" && !Object.hasOwn(attrs, "open")
      ? (node.childNodes ?? []).filter(child => child.tagName === "summary").slice(0, 1)
      : node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], depth: depth + 1, inHead, inNavigation });
  }
  const visible = text.join(" ").replace(/\s+/g, " ").trim();
  const gate = /^(?:access denied|forbidden|authentication required|you are not signed in[.!]?|(?:please )?(?:sign in|log in|login)(?: required| to (?:view|continue|access)[^.]*)?[.!]?|sign in, then try opening[^.]*[.!]?|需要登录[。！]?|请先登录[。！]?|无权访问[。！]?|登录后.{0,8}(?:查看|访问)[。！]?)$/i;
  return { readable: Boolean(visible) && !/^(?:loading[. …]*|please wait[. …]*|redirecting[. …]*|正在加载[. …]*)$/i.test(visible), frames, deliveryConfig, baseHref, refresh, denied: password || deniedMeta || blocks.some(block => gate.test(block) || /^(?:please )?(?:sign in|log in|login) to (?:view|access|continue)\b/i.test(block)) || gate.test(visible) };
}


try { parentPort.postMessage({ document: reportDocument(workerData) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
