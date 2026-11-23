import { readFile, writeFile } from 'node:fs/promises';
import { createMekoClient } from '../docs/meko-client.js';
import { runResearch } from '../docs/research.js';
import { topics } from '../docs/topics.js';

const client = createMekoClient();
const history = [];
for (const { question } of topics) {
  const baseline = await runResearch(question, { history });
  await runResearch(question, { client });
  history.push(baseline.historyEntry);
}

const runs = [];
for (let pass = 1; pass <= 2; pass++) {
  for (const { id, question } of topics) {
    const baselineFirst = (runs.length + pass) % 2 === 1;
    const settings = { baseline: { history }, shared: { client } };
    const results = {};
    for (const mode of baselineFirst ? ['baseline', 'shared'] : ['shared', 'baseline']) {
      results[mode] = await runResearch(question, settings[mode]);
    }
    runs.push({ topic: id, pass, question, first: baselineFirst ? 'baseline' : 'shared',
      baseline: results.baseline.metrics, shared: results.shared.metrics });
    history.push(results.baseline.historyEntry);
  }
}

function mean(mode, field) {
  const values = runs.map(run => run[mode][field]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
const summary = Object.fromEntries(['shared', 'baseline'].map(mode => [mode, {
  runs: runs.length,
  meanEstimatedTokens: mean(mode, 'tokens'),
  meanLatencyMs: mean(mode, 'latencyMs'),
  meanCoveragePercent: mean(mode, 'quality'),
  meanRelevance: mean(mode, 'meanRelevance'),
}]));
const tokenReductionPercent = 100 * (1 - summary.shared.meanEstimatedTokens / summary.baseline.meanEstimatedTokens);
const metrics = { mode: 'offline-demo', warmupRunsPerMode: topics.length, summary, tokenReductionPercent, runs };
const format = (label, item) => `| ${label} | ${item.runs} | ${item.meanEstimatedTokens.toFixed(1)} | ${item.meanLatencyMs.toFixed(3)} ms | ${item.meanCoveragePercent.toFixed(1)}% | ${item.meanRelevance?.toFixed(3) ?? '—'} |`;
const table = [
  '| Mode | Runs | Mean estimated tokens | Mean time to brief | Mean coverage | Mean relevance |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  format('Shared memory (demo, warm)', summary.shared),
  format('Full-history replay', summary.baseline),
].join('\n');
const caption = `Mean estimated token reduction: **${tokenReductionPercent.toFixed(1)}%** on this run.`;
const readme = new URL('../README.md', import.meta.url);
const markdown = await readFile(readme, 'utf8');
const block = /<!-- benchmark:start -->[\s\S]*?<!-- benchmark:end -->/;
if (!block.test(markdown)) throw new Error('README benchmark markers are missing.');
await writeFile(new URL('../docs/metrics.json', import.meta.url), JSON.stringify(metrics, null, 2) + '\n');
await writeFile(readme, markdown.replace(block, `<!-- benchmark:start -->\n${table}\n\n${caption}\n<!-- benchmark:end -->`));
console.log(`${table}\n\n${caption}`);
