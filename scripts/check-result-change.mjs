import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog, validateSnapshot, parseReportFile, publicEvidenceUrl } from "./prepare-data.mjs";

const reportPattern = /^results\/([a-z0-9-]+)\/([a-z0-9-]+-v[1-9]\d*-report\.json)(?![\s\S])/;
const maximumBytes = 1024 * 1024;

function rejectCredentials(value) {
  if (typeof value === "string") {
    if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/.test(value)) throw new Error("A submission contains a credential-like value. Remove credentials before submitting.");
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) { rejectCredentials(key); rejectCredentials(child); }
  }
}

function parsePublicJSON(raw) {
  // Inspect every string token, including values hidden by duplicate JSON keys.
  for (const [token] of raw.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    let value;
    try { value = JSON.parse(token); } catch { throw new Error("Invalid JSON string"); }
    rejectCredentials(value);
  }
  try { return JSON.parse(raw); } catch { throw new Error("Invalid JSON document"); }
}

export function checkResultChange(baseCatalog, catalog, changes, publishedPaths) {
  const resultChanges = changes.filter(change => change.path.startsWith("results/"));
  for (const change of resultChanges) {
    if (change.status !== "A") throw new Error("Published reports are immutable. Add a new version; do not edit, delete or rename an existing report.");
  }
  if (!resultChanges.length) return { reports: 0 };
  if (resultChanges.length > 20) throw new Error("Split submissions into at most 20 report files per pull request.");
  if (changes.some(change => change.path !== "benchmarks/catalog.json" && !reportPattern.test(change.path))) {
    throw new Error("Submit results separately from code, definitions and website changes.");
  }
  const { providerUrls: originalUrls, ...originalDefinitions } = baseCatalog;
  const { providerUrls, ...definitions } = catalog;
  if (!isDeepStrictEqual(originalDefinitions, definitions)) throw new Error("A result submission may only add participant project URLs to the catalog. Definition changes need a separate pull request.");
  if (Object.entries(originalUrls).some(([id, url]) => providerUrls?.[id] !== url)) throw new Error("Existing participant URLs cannot be changed by a result submission.");
  validateCatalog(catalog);
  rejectCredentials(providerUrls);
  const latest = new Map();
  for (const published of publishedPaths) {
    const match = reportPattern.exec(published);
    if (!match) continue;
    const { version } = parseReportFile(match[1], match[2]);
    latest.set(match[1], Math.max(latest.get(match[1]) ?? 0, Number(version.slice(1))));
  }
  const reports = resultChanges.map(change => {
    const match = reportPattern.exec(change.path);
    if (!match || change.mode !== "100644") throw new Error("Reports must be regular JSON files in a benchmark directory.");
    if (Buffer.byteLength(change.content, "utf8") > maximumBytes) throw new Error("A report exceeds 1 MiB. Keep raw logs and large evidence outside Git.");
    const entry = parseReportFile(match[1], match[2]);
    const report = parsePublicJSON(change.content);
    rejectCredentials(report);
    if (!publicEvidenceUrl(report.source?.url)) throw new Error("New submissions require a public HTTPS source URL with a DNS hostname and no credentials.");
    validateSnapshot(report, entry, catalog);
    return { entry, report };
  }).sort((a, b) => a.entry.benchmarkId.localeCompare(b.entry.benchmarkId) || Number(a.entry.version.slice(1)) - Number(b.entry.version.slice(1)));
  const participants = new Set(reports.flatMap(({ report }) => report.benchmarks[0].providers.map(provider => provider.id)));
  for (const id of Object.keys(providerUrls)) {
    if (!Object.hasOwn(originalUrls, id) && !participants.has(id)) throw new Error("Only add project URLs used by this submission.");
  }
  for (const { entry } of reports) {
    const next = (latest.get(entry.benchmarkId) ?? 0) + 1;
    if (entry.version !== `v${next}`) throw new Error(`Expected ${entry.benchmarkId} v${next}. Rebase the submission if another version was published first.`);
    latest.set(entry.benchmarkId, next);
  }
  return { reports: reports.length };
}

export function checkGitChange(base, head) {
  if (![base, head].every(sha => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sha))) throw new Error("Use full commit hashes for the submission check.");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const read = (ref, file) => git("show", `${ref}:${file}`);
  const fields = git("diff", "--name-status", "--no-renames", "-z", base, head, "--").split("\0");
  const changes = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    const [status, file] = fields.slice(index, index + 2);
    const record = { status, path: file };
    if (file === "benchmarks/catalog.json") {
      const info = git("ls-tree", head, "--", file).split(/\s+/);
      if (info[0] !== "100644" || info[1] !== "blob") throw new Error("The catalog must remain a regular non-executable JSON file.");
    }
    if (file?.startsWith("results/") && status === "A") {
      if (!reportPattern.test(file)) throw new Error("Invalid result report path.");
      const info = git("ls-tree", head, "--", file).split(/\s+/);
      if (info[0] !== "100644" || info[1] !== "blob") throw new Error("Result submissions cannot contain symbolic links or executable files.");
      if (Number(git("cat-file", "-s", `${head}:${file}`)) > maximumBytes) throw new Error("A report exceeds 1 MiB.");
      record.mode = info[0];
      record.content = read(head, file);
    }
    changes.push(record);
  }
  return checkResultChange(JSON.parse(read(base, "benchmarks/catalog.json")), parsePublicJSON(read(head, "benchmarks/catalog.json")), changes, git("ls-tree", "-r", "--name-only", "-z", base, "--", "results/").split("\0").filter(Boolean));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(checkGitChange(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
