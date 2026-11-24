import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const observations = JSON.parse(await readFile(new URL("./fixtures/report-observations.json", import.meta.url), "utf8"));
for (const evidence of observations.entries) {
  test(`${evidence.benchmark} ${evidence.version} retains the published report measurements and population`, async () => {
    const report = JSON.parse(await readFile(new URL(`../results/${evidence.benchmark}/${evidence.benchmark}-${evidence.version}-report.json`, import.meta.url), "utf8"));
    const benchmark = report.benchmarks[0];
    assert.equal(benchmark.taskCount, evidence.taskCount);
    assert.deepEqual(benchmark.providers.map(row => row.id).sort(), evidence.rows.map(row => row.id).sort());
    for (const row of evidence.rows) {
      const provider = benchmark.providers.find(provider => provider.id === row.id);
      for (const [metric, value] of Object.entries(row.scores)) assert.equal(provider.scores[metric], value, `${row.id}: ${metric}`);
      if (row.categoryPassed) assert.deepEqual(provider.categoryPassed, row.categoryPassed);
      if (row.passed !== undefined) assert.equal(provider.passed, row.passed);
      for (const metric of evidence.undisclosed ?? []) assert.equal(provider.scores[metric], null, `${row.id}: undisclosed ${metric}`);
    }
    for (const [metric, count] of Object.entries(evidence.samples ?? {})) assert.equal(benchmark.metricSamples[metric].sampleCount, count);
  });
}
