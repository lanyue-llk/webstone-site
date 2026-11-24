import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes, content]) => !/\bsrc\s*=/i.test(attributes) && content.trim())
    .map(([, , content]) => `'sha256-${createHash("sha256").update(content).digest("base64")}'`);
}

export function assertScriptPolicy(policy, expectedPolicy, html) {
  function directives(value) {
    const result = new Map();
    for (const part of value.split(";").filter(part => part.trim())) {
      const [name, ...sources] = part.trim().split(/\s+/);
      assert.ok(!result.has(name), "Duplicate CSP directive: " + name);
      result.set(name, sources);
    }
    return result;
  }
  const actual = directives(policy), expected = directives(expectedPolicy);
  const sources = actual.get("script-src") ?? [];
  assert.ok(sources.length > 0, "Missing script-src policy");
  assert.ok(sources.every(source => source === "'self'" || /^'sha256-[A-Za-z0-9+/]{43}='$/.test(source)), "Unexpected script source");
  assert.ok(!actual.has("script-src-elem") && !actual.has("script-src-attr"), "Unexpected script policy override");
  assert.deepEqual(new Set(sources), new Set(expected.get("script-src")), "Published script sources must match the build policy");
  for (const hash of inlineScriptHashes(html)) assert.ok(sources.includes(hash), "Published policy must authorize every inline script");
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
