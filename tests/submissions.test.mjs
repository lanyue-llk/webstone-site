import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkResultChange, checkGitChange } from "../scripts/check-result-change.mjs";

const catalog = JSON.parse(readFileSync(new URL("../benchmarks/catalog.json", import.meta.url), "utf8"));
const original = JSON.parse(readFileSync(new URL("../results/lexbench-webfetch/lexbench-webfetch-v1-report.json", import.meta.url), "utf8"));
const published = ["results/lexbench-webfetch/lexbench-webfetch-v1-report.json"];
const report = version => ({ ...structuredClone(original), source: { ...original.source, url: "https://example.com/evaluation" }, id: `lexbench-webfetch-v${version}`, version: `v${version}` });
const addition = version => ({ path: `results/lexbench-webfetch/lexbench-webfetch-v${version}-report.json`, status: "A", mode: "100644", content: JSON.stringify(report(version)) });

test("result submissions add the next version without changing definitions or history", () => {
  assert.deepEqual(checkResultChange(catalog, catalog, [addition(2)], published), { reports: 1 });
  assert.deepEqual(checkResultChange(catalog, catalog, [{ path: "README.md", status: "M" }], published), { reports: 0 });
  for (const status of ["M", "D", "T"]) assert.throws(() => checkResultChange(catalog, catalog, [{ ...addition(2), status }], published), /immutable/);
  assert.throws(() => checkResultChange(catalog, catalog, [addition(3)], published), /Expected lexbench-webfetch v2/);
  assert.throws(() => checkResultChange(catalog, catalog, [addition(2), { path: "web/app/page.tsx", status: "M" }], published), /separately from code/);
  const changed = structuredClone(catalog);
  changed.benchmarks[0].description = "Changed definition";
  assert.throws(() => checkResultChange(catalog, changed, [addition(2)], published), /separate pull request/);
  const paths = Array.from({ length: 9 }, (_, i) => `results/lexbench-webfetch/lexbench-webfetch-v${i + 1}-report.json`);
  assert.deepEqual(checkResultChange(catalog, catalog, [addition(11), addition(10)], paths), { reports: 2 });
});

test("external submissions can add their own public project and evidence URLs", () => {
  const next = structuredClone(catalog);
  next.providerUrls["new-method"] = "https://example.com/product";
  const data = report(2);
  data.source.url = "https://example.com/evaluation";
  data.source.kind = "report-page";
  data.benchmarks[0].providers[0].id = "new-method";
  const change = { ...addition(2), content: JSON.stringify(data) };
  assert.deepEqual(checkResultChange(catalog, next, [change], published), { reports: 1 });
  next.providerUrls.moli = "https://example.com/replacement";
  assert.throws(() => checkResultChange(catalog, next, [change], published), /Existing participant URLs/);
  const invalid = report(2);
  invalid.source.url = "http://example.com/report";
  assert.throws(() => checkResultChange(catalog, catalog, [{ ...addition(2), content: JSON.stringify(invalid) }], published), /HTTPS source/);
});

test("untrusted result configuration, notes and translations must have display-safe types", () => {
  for (const mutate of [
    item => { item.benchmarks[0].providers[0].description = { unsafe: "object" }; },
    item => { item.benchmarks[0].notes = "not an array"; },
    item => { item.translations = { zh: { label: { unsafe: true } } }; },
    item => { item.benchmarks[0].providers[0].scores = []; },
  ]) {
    const data = report(2);
    mutate(data);
    assert.throws(() => checkResultChange(catalog, catalog, [{ ...addition(2), content: JSON.stringify(data) }], published), /Invalid|invalid/);
  }
});

test("public submissions reject local evidence, escaped credentials and unused inherited names", () => {
  for (const host of ["localhost", "127.0.0.1", "192.168.1.1", "[::1]", "[fd00::1]", "reports.local"]) {
    const data = report(2);
    data.source.url = `https://${host}/report`;
    assert.throws(() => checkResultChange(catalog, catalog, [{ ...addition(2), content: JSON.stringify(data) }], published), /public HTTPS/);
  }
  const data = report(2);
  data.benchmarks[0].notes.push("ghp_" + "x".repeat(36));
  const escaped = JSON.stringify(data).replace("ghp_", "\\u0067hp_");
  assert.throws(() => checkResultChange(catalog, catalog, [{ ...addition(2), content: escaped }], published), /credential-like/);
  for (const prefix of ["\n", "\t"]) {
    data.benchmarks[0].notes = [prefix + "ghp_" + "x".repeat(36)];
    assert.throws(() => checkResultChange(catalog, catalog, [{ ...addition(2), content: JSON.stringify(data) }], published), /credential-like/);
  }
  const next = structuredClone(catalog);
  next.providerUrls[data.benchmarks[0].providers[0].id] += "?token=ghp_" + "x".repeat(36);
  assert.throws(() => checkResultChange(next, next, [addition(2)], published), /credential-like/);
  for (const key of ["constructor", "toString"]) {
    const extra = structuredClone(catalog);
    extra.providerUrls[key] = "https://example.com/project";
    assert.throws(() => checkResultChange(catalog, extra, [addition(2)], published), /Only add project URLs/);
  }
});

test("the Git boundary rejects symlinks, mixed code changes and invalid paths", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "webstone-submission-git-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.com");
  mkdirSync(path.join(directory, "benchmarks"));
  mkdirSync(path.join(directory, "results/lexbench-webfetch"), { recursive: true });
  writeFileSync(path.join(directory, "benchmarks/catalog.json"), JSON.stringify(catalog));
  writeFileSync(path.join(directory, published[0]), JSON.stringify(original));
  git("add", "."); git("commit", "-m", "Base fixture");
  let base = git("rev-parse", "HEAD");
  const file = path.join(directory, addition(2).path);
  writeFileSync(file, addition(2).content);
  git("add", "."); git("commit", "-m", "Valid new report");
  assert.deepEqual(checkGitChangeFrom(directory, base, git("rev-parse", "HEAD")), { reports: 1 });
  const contributor = git("rev-parse", "HEAD");
  git("checkout", "-b", "advanced-main", base);
  writeFileSync(path.join(directory, "README.md"), "Unrelated upstream code change");
  git("add", "."); git("commit", "-m", "Main advanced independently");
  base = git("rev-parse", "HEAD");
  git("merge", "--no-edit", contributor);
  assert.deepEqual(checkGitChangeFrom(directory, base, git("rev-parse", "HEAD")), { reports: 1 });
  rmSync(file); symlinkSync("../../benchmarks/catalog.json", file);
  git("add", "."); git("commit", "-m", "Unsafe link");
  assert.throws(() => checkGitChangeFrom(directory, base, git("rev-parse", "HEAD")), /symbolic links/);
});

function checkGitChangeFrom(directory, base, head) {
  const previous = process.cwd();
  try { process.chdir(directory); return checkGitChange(base, head); }
  finally { process.chdir(previous); }
}
