import { knowledge, termRelevance, terms, topics } from './topics.js';

export function createDemoStore() {
  const memories = [], artifacts = new Map(), traces = new Map(), usage = [];
  const searchable = item => `${topics.find(t => t.id === item.topic)?.title ?? ''} ${item.title} ${item.text}`;
  const index = new WeakMap();
  function ranker(records) {
    let priorQuery, ranked = [];
    return {
      invalidate() { priorQuery = undefined; },
      rank(query, limit) {
        if (query !== priorQuery) {
          const queryTerms = terms(query);
          ranked = records.map(item => {
            if (!index.has(item)) index.set(item, terms(searchable(item)));
            return { ...item, score: termRelevance(queryTerms, index.get(item)) };
          }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
          priorQuery = query;
        }
        return structuredClone(ranked.slice(0, limit));
      },
    };
  }
  const memoryIndex = ranker(memories), knowledgeIndex = ranker(knowledge);
  return {
    mode: 'demo',
    async datapack_describe() { return { id: 'research-collective-demo', name: 'Research Collective · local datapack' }; },
    async conversation_create({ runId }) { return { id: runId }; },
    async context_search({ query, limit = 8 }) {
      return { memory: memoryIndex.rank(query, limit), knowledge: knowledgeIndex.rank(query, limit), conversation: [] };
    },
    async memory_search({ query, limit = 8 }) { return { memory: memoryIndex.rank(query, limit) }; },
    async knowledgebase_search({ query, limit = 8 }) { return { knowledge: knowledgeIndex.rank(query, limit) }; },
    async memory_add({ record, agent }) {
      const item = { ...record, id: `memory-${memories.length + 1}`, agent };
      memories.unshift(item);
      memoryIndex.invalidate();
      return { id: item.id };
    },
    async track_token_usage(observation) {
      usage.push(structuredClone(observation));
      return { recorded: true };
    },
    async artifact_put({ version, text }) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const artifact = { id: hash, hash, version, text };
      artifacts.set(hash, artifact);
      return { ...artifact };
    },
    async artifact_get({ hash }) { return artifacts.has(hash) ? { ...artifacts.get(hash) } : null; },
    async trace_record({ runId, events, metrics }) {
      traces.set(runId, structuredClone({ runId, events, metrics }));
      return { id: runId };
    },
    async trace_read({ runId }) { return structuredClone(traces.get(runId) ?? null); },
    async browse() {
      return structuredClone({
        memories: memories.filter(item => item.kind !== 'learning'),
        learnings: memories.filter(item => item.kind === 'learning'),
        knowledge,
      });
    },
  };
}
