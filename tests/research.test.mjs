import assert from 'node:assert/strict';
import test from 'node:test';
import { createMekoClient } from '../docs/meko-client.js';
import { agents, compareResearch, estimateTokens, runResearch } from '../docs/research.js';
import { topics } from '../docs/topics.js';

test('token estimator handles words, punctuation, whitespace and long pieces', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('  tiny    words.\n'), 4);
  assert.equal(estimateTokens('alphabet'), 2);
});

test('all seeded topics produce equivalent coverage with cheaper estimated context', async () => {
  const client = createMekoClient();
  const history = [];
  for (const { question, sources } of topics) {
    const { shared, baseline, tokenReduction } = await compareResearch(question, { client, history });
    assert.equal(shared.question, baseline.question);
    assert.equal(shared.metrics.quality, 100);
    assert.equal(baseline.metrics.quality, shared.metrics.quality);
    assert.ok(tokenReduction > 0);
    assert.equal(baseline.metrics.meanRelevance, null);
    assert.ok(baseline.retrievals.every(result => result.hits.length === 0));
    assert.equal(baseline.artifact, undefined);
    assert.ok(shared.retrievals.every(result => result.hits.some(hit => Number.isFinite(hit.score))));
    for (const source of sources) assert.ok(shared.brief.includes(source.id));
    history.push(baseline.historyEntry);
  }
});

test('a related question reuses verified learning and reduces shared context vs its cold run', async () => {
  const client = createMekoClient();
  const cold = await runResearch(topics[0].question, { client });
  const warm = await runResearch('How does multi-agent shared memory work?', { client });
  assert.ok(warm.metrics.reused > cold.metrics.reused);
  assert.ok(warm.metrics.inputTokens < cold.metrics.inputTokens);
  assert.equal(warm.metrics.quality, 100);
  assert.ok(warm.trace.some(event => event.agent === 'Writer' && event.type === 'reuse' && event.detail.includes('verified practice')));
  assert.equal((await client.browse()).learnings.length, 1);
  assert.notEqual(warm.version, cold.version);
  assert.equal((await client.artifact_get({ hash: cold.artifact.hash })).text, cold.brief);
});

test('trace shows retrieval before work, stage estimates, memory updates and versioned artifact', async () => {
  const client = createMekoClient();
  const result = await runResearch(topics[1].question, { client });
  for (const agent of agents) {
    const own = result.trace.filter(event => event.agent === agent);
    assert.deepEqual(own.slice(0, 3).map(event => event.type), ['tool', 'tool', 'retrieval']);
    assert.deepEqual(own.slice(0, 2).map(event => event.detail), ['context_search', 'memory_search']);
    assert.ok(own.some(event => event.type === 'tokens' && event.inputTokens > 0));
  }
  const saved = await client.trace_read({ runId: result.runId });
  assert.deepEqual(saved.metrics, result.metrics);
  assert.ok(saved.events.some(event => event.type === 'memory update'));
  assert.ok(saved.events.some(event => event.type === 'artifact' && event.detail.includes(result.artifact.hash)));
  assert.ok(result.trace.some(event => event.detail === 'track_token_usage'));
});

test('an unknown question abstains rather than writing unverified learnings', async () => {
  const client = createMekoClient();
  const result = await runResearch('Where can turtles hibernate?', { client });
  assert.match(result.brief, /Evidence gap/);
  assert.equal(result.metrics.quality, null);
  assert.equal((await client.browse()).learnings.length, 0);
});
