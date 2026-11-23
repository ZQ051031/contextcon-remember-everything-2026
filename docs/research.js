import { knowledge, selectTopic } from './topics.js';

export const agents = ['Researcher', 'Summariser', 'Writer', 'Analyst'];
export const estimateTokens = text =>
  (String(text).match(/[\p{L}\p{N}]+|[^\s]/gu) ?? []).reduce((sum, piece) => sum + Math.ceil(piece.length / 4), 0);

const compact = ({ id, fact }) => ({ id, fact });
const extract = source => ({ id: source.id, fact: source.text.split('Finding: ')[1].split(' Notes:')[0] });
const score = topic => text => topic ? Math.round(100 * topic.sources.filter(source =>
  text.includes(`${source.fact} [${source.id}]`)).length / topic.sources.length) : null;
const distinct = rows => [...new Map(rows.map(row => [row.id, row])).values()];

function validFacts(topic, record) {
  return Boolean(topic && Array.isArray(record?.facts) && record.facts.length === topic.sources.length
    && topic.sources.every(source => record.facts.some(fact => fact?.id === source.id && fact.fact === source.fact)));
}

function validLearning(topic, record) {
  return validFacts(topic, record) && record.text === topic.learning && record.verified === true;
}

export async function runResearch(question, { client = null, history = [], progress = () => {} } = {}) {
  question = question.trim();
  if (!question) throw new Error('Enter a research question.');
  if (question.length > 500) throw new Error('Use 500 characters or fewer.');
  const start = performance.now(), runId = crypto.randomUUID(), shared = Boolean(client);
  const trace = [], retrievals = [], usage = [], working = [];
  const topic = selectTopic(question), query = topic ? `${topic.title} · ${topic.question}` : question;
  let conversationId, datapack, reused = 0, replay;
  function event(agent, type, detail, extra = {}) {
    trace.push({ step: trace.length + 1, agent, type, detail, elapsedMs: performance.now() - start, ...extra });
  }
  async function call(agent, tool, args, optional = false) {
    const started = performance.now();
    try {
      const result = await client[tool]({ conversationId, agent, ...args });
      event(agent, 'tool', tool, { durationMs: performance.now() - started });
      return result;
    } catch (error) {
      event(agent, 'warning', `${tool}: ${error.message}`);
      if (!optional) throw error;
    }
  }
  if (shared) {
    datapack = await call('Pipeline', 'datapack_describe');
    ({ id: conversationId } = await call('Pipeline', 'conversation_create', { runId, title: question }));
  }
  async function retrieve(agent) {
    progress(agent);
    if (!shared) {
      replay = JSON.stringify({ sources: knowledge, history, handoffs: working });
      retrievals.push({ agent, hits: [] });
      event(agent, 'retrieval', `Full-history replay: ${knowledge.length} notes and ${history.length} prior runs; no shared lookup.`);
      return { memory: [], knowledge: JSON.parse(replay).sources };
    }
    const context = await call(agent, 'context_search', { query, limit: 8 });
    const memory = await call(agent, 'memory_search', { query, limit: 10 });
    const hits = distinct([...memory.memory, ...context.memory, ...context.knowledge, ...context.conversation]);
    retrievals.push({ agent, hits });
    event(agent, 'retrieval', `${hits.length} hits returned; only checked records can become evidence.`,
      { hits: hits.map(({ id, kind, score }) => ({ id, kind, score })) });
    return { memory: distinct([...memory.memory, ...context.memory]), knowledge: context.knowledge };
  }
  async function save(agent, record) {
    const entry = await call(agent, 'memory_add', { record });
    event(agent, 'memory update', `Saved ${record.kind}: ${record.title}`, { id: entry.id });
  }
  function account(agent, input, output) {
    const inputTokens = estimateTokens([question, shared ? JSON.stringify(input) : replay].join('\n'));
    const outputTokens = estimateTokens(typeof output === 'string' ? output : JSON.stringify(output));
    usage.push({ agent, inputTokens, outputTokens });
    event(agent, 'tokens', 'Estimated context + output; no model calls.', { inputTokens, outputTokens });
    working.push(output);
  }
  function recall(items, kind, verifier = validFacts) {
    return items.find(item => item.topic === topic?.id && item.kind === kind && verifier(topic, item));
  }
  function reuse(agent, item) {
    reused++;
    event(agent, 'reuse', `Used ${item.title} after checking seeded provenance.`, { id: item.id, score: item.score });
  }

  const researchContext = await retrieve('Researcher');
  const cachedSources = recall(researchContext.memory, 'sources');
  const localSources = topic ? knowledge.filter(source => source.topic === topic.id) : [];
  let rawSources = [];
  if (cachedSources) {
    reuse('Researcher', cachedSources);
  } else {
    const matched = new Map(researchContext.knowledge.map(hit => [hit.id, hit]));
    rawSources = localSources.map(source => matched.get(source.id)?.text === source.text ? matched.get(source.id) : source);
    event('Researcher', 'decision', rawSources.length ? 'Read seed notes for uncovered evidence.' : 'No matching seed topic.',
      { sourceIds: rawSources.map(source => source.id) });
  }
  const facts = cachedSources?.facts ?? rawSources.map(extract);
  account('Researcher', cachedSources ? cachedSources.facts : rawSources.map(source => source.text), facts);
  if (shared && facts.length && !cachedSources) {
    await save('Researcher', { kind: 'sources', topic: topic.id, title: `${topic.title} · source facts`, facts,
      text: facts.map(fact => fact.fact).join(' ') });
  }

  const summaryContext = await retrieve('Summariser');
  const cachedSummary = recall(summaryContext.memory, 'summary');
  const sourceHandoff = recall(summaryContext.memory, 'sources');
  const summary = cachedSummary?.facts ?? sourceHandoff?.facts ??
    (shared ? facts : summaryContext.knowledge.filter(source => source.topic === topic?.id).map(extract));
  if (cachedSummary || sourceHandoff) reuse('Summariser', cachedSummary ?? sourceHandoff);
  else event('Summariser', 'decision', 'Condensed the current evidence handoff.');
  const summaryText = summary.map(fact => `- ${fact.fact} [${fact.id}]`).join('\n');
  account('Summariser', summary, summaryText);
  if (shared && summary.length && !cachedSummary) {
    await save('Summariser', { kind: 'summary', topic: topic.id, title: `${topic.title} · digest`, facts: summary, text: summaryText });
  }

  const writerContext = await retrieve('Writer');
  const digest = recall(writerContext.memory, 'summary');
  const priorLearning = recall(writerContext.memory, 'learning', validLearning);
  const writerFacts = digest?.facts ?? (shared ? summary : writerContext.knowledge.filter(source => source.topic === topic?.id).map(extract));
  const writerDigest = writerFacts.map(fact => `- ${fact.fact} [${fact.id}]`).join('\n');
  if (digest) reuse('Writer', digest);
  if (priorLearning) reuse('Writer', priorLearning);
  const version = `brief-v-${runId}`;
  const citations = topic?.sources.map(source => `- [${source.id}] ${source.title} (synthetic seed)`).join('\n');
  const recommendation = priorLearning?.text ?? topic?.learning;
  const brief = topic
    ? `# ${topic.title}\n\nQuestion: ${question}\n\n## Findings\n${writerDigest}\n\n## Recommendation\n${recommendation}\n\n## Evidence\n${citations}\n\nScope: synthetic corpus; not externally verified.\n\nVersion: ${version}`
    : `# Evidence gap\n\nQuestion: ${question}\n\nNo matching synthetic evidence is available. Try a seeded topic. Datapack hits, if any, are shown separately and were not fact-checked.\n\nVersion: ${version}`;
  event('Writer', 'decision', topic ? 'Drafted a brief with evidence IDs and scope.' : 'Abstained rather than inventing findings.');
  account('Writer', { digest: writerDigest, recommendation }, brief);

  const analystContext = await retrieve('Analyst');
  const learning = recall(analystContext.memory, 'learning', validLearning);
  const quality = score(topic)(brief);
  if (learning) reuse('Analyst', learning);
  else if (shared && quality === 100) {
    await save('Analyst', { kind: 'learning', topic: topic.id, title: `${topic.title} · verified practice`,
      text: topic.learning, verified: true, facts: topic.sources.map(compact) });
  }
  const relevant = retrievals.flatMap(row => row.hits).map(row => row.score).filter(Number.isFinite);
  const meanRelevance = relevant.length ? relevant.reduce((sum, value) => sum + value, 0) / relevant.length : null;
  event('Analyst', 'decision', quality === null ? 'No reference topic to score.' : 'Checked exact fact and citation pairs against the fixture.');
  account('Analyst', { facts: summary, recommendation }, { quality, meanRelevance });
  const inputTokens = usage.reduce((sum, row) => sum + row.inputTokens, 0);
  const outputTokens = usage.reduce((sum, row) => sum + row.outputTokens, 0);
  const metrics = { inputTokens, outputTokens, tokens: inputTokens + outputTokens,
    latencyMs: performance.now() - start, quality, meanRelevance, reused };
  let artifact;
  if (shared) {
    artifact = await call('Writer', 'artifact_put', { version, text: brief });
    event('Writer', 'artifact', `Saved ${version} · ${artifact.hash}`);
    event('Analyst', 'tool', 'conversation_add_message · persist decision trace');
    const stored = await call('Analyst', 'trace_record', { runId, question, brief, events: trace, metrics });
    await call('Analyst', 'track_token_usage', { ...metrics, messageId: stored.messageId }, true);
  }
  return { runId, question, mode: client?.mode ?? 'baseline', datapack, conversationId, version, brief, artifact,
    trace, retrievals, metrics, historyEntry: { question, topic: topic?.id, brief, stageOutputs: working.slice(0, 3) } };
}

export async function compareResearch(question, { client, history = [], progress } = {}) {
  const baseline = await runResearch(question, { history });
  const shared = await runResearch(question, { client, progress });
  const tokenReduction = 100 * (baseline.metrics.tokens - shared.metrics.tokens) / baseline.metrics.tokens;
  return { shared, baseline, tokenReduction };
}
