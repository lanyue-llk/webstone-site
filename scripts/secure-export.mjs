import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes, content]) => !/\bsrc\s*=/i.test(attributes) && content.trim())
    .map(([, , content]) => `'sha256-${createHash("sha256").update(content).digest("base64")}'`);
}

async function main() {
  const root = new URL("../web/out/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  const hashes = new Set();
  for (const file of files.filter(file => file.endsWith(".html"))) {
    for (const hash of inlineScriptHashes(await readFile(new URL(file, root), "utf8"))) hashes.add(hash);
  }
  const headers = await readFile(new URL("_headers", root), "utf8");
  const secured = headers.replace("script-src 'self'", `script-src 'self' ${[...hashes].join(" ")}`);
  if (!hashes.size || secured === headers) throw new Error("Static export script policy could not be generated");
  if (secured.split("\n").some(line => line.length > 2000)) throw new Error("Pages header exceeds its 2000-character limit");
  await writeFile(new URL("_headers", root), secured);
  console.log(`Secured ${hashes.size} inline scripts in the static export.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
