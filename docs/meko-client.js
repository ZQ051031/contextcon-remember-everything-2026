import { createDemoStore } from './demo-store.js';

const CLOUD_MCP = 'https://mcp.mekodata.ai/mcp';
const APP_AGENT = 'research-collective';
const PREFIX = 'Research Collective record: ';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = text => btoa(Array.from(encoder.encode(text), byte => String.fromCharCode(byte)).join(''));
const fromBase64 = text => decoder.decode(Uint8Array.from(atob(text), char => char.charCodeAt(0)));

function readReply(body, eventStream, id) {
  if (!eventStream) return JSON.parse(body);
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5)).join('\n');
    if (data.trim()) {
      const reply = JSON.parse(data);
      if (reply.id === id) return reply;
    }
  }
  throw new Error('Meko MCP returned no matching response.');
}

function transport(apiKey, fetcher) {
  let nextId = 0, session, protocol = '2025-03-26', ready;
  async function rpc(method, params, notification = false) {
    const id = notification ? undefined : ++nextId;
    const response = await fetcher(CLOUD_MCP, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${apiKey}`, 'User-Agent': 'contextcon-research-collective/1.0',
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(method !== 'initialize' ? { 'MCP-Protocol-Version': protocol } : {}),
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!response.ok) throw new Error(`Meko MCP ${method} returned HTTP ${response.status}.`);
    if (method === 'initialize') session = response.headers.get('mcp-session-id');
    if (notification) return;
    const reply = readReply(await response.text(), response.headers.get('content-type')?.includes('text/event-stream'), id);
    if (reply.error || reply.id !== id || !reply.result) {
      throw new Error(`Meko MCP ${method} failed${reply.error?.code ? ` (${reply.error.code})` : ''}.`);
    }
    return reply.result;
  }
  async function initialize() {
    const result = await rpc('initialize', { protocolVersion: protocol, capabilities: {},
      clientInfo: { name: 'contextcon-research-collective', version: '1.0.0' } });
    protocol = result.protocolVersion ?? protocol;
    await rpc('notifications/initialized', undefined, true);
  }
  return async (name, args) => {
    await (ready ??= initialize().catch(error => { ready = undefined; throw error; }));
    const result = await rpc('tools/call', { name, arguments: args });
    const raw = result.content?.find(item => item.type === 'text')?.text;
    let data = result.structuredContent;
    if (data === undefined && raw) {
      try { data = JSON.parse(raw); } catch { /* Report a tool error without exposing remote text. */ }
    }
    if (result.isError || !data || data.error || data.detail?.error || typeof data.detail === 'string') {
      throw new Error(`Meko tool ${name} failed.`);
    }
    return data.data ?? data;
  };
}

function bounded(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function normalize(hit, kind) {
  const raw = hit.memory ?? hit.data ?? hit.chunk_text ?? hit.content ?? hit.text ?? '';
  let record;
  if (kind === 'memory' && typeof raw === 'string' && raw.startsWith(PREFIX)) {
    try { record = JSON.parse(raw.slice(PREFIX.length)); } catch { /* Allow other datapack records. */ }
  }
  return {
    ...(record ?? { kind, text: typeof raw === 'string' ? raw : '',
      title: hit.title ?? (kind === 'knowledge' ? `Knowledge chunk · ${hit.document_id ?? hit.id}` : 'Datapack record') }),
    id: hit.id ?? hit.memory_id ?? hit.message_id ?? hit.document_id,
    agent: hit.agent_id ?? record?.agent,
    score: bounded(hit.score ?? hit.relevance_score ?? hit.rerank_score ??
      (Number.isFinite(hit.distance) ? 1 - hit.distance : undefined)),
  };
}

export function createMekoClient({ apiKey = '', datapackId, fetcher = globalThis.fetch } = {}) {
  if (!apiKey.trim()) return createDemoStore();
  if (!datapackId?.trim()) throw new Error('Set MEKO_DATAPACK_ID or datapackId in config/meko.config.json.');
  const tool = transport(apiKey.trim(), fetcher);
  const call = (name, params = {}) => tool(name, { ...params, datapack_id: datapackId.trim() });
  const scope = ({ conversationId, agent }) => ({ conversation_id: conversationId,
    agent_id: agent ? `research-collective-${agent.toLowerCase()}` : APP_AGENT });
  return {
    mode: 'live',
    async datapack_describe() {
      const result = await call('datapack_describe');
      const pack = result.datapack ?? result;
      return { id: pack.datapack_id ?? pack.id ?? datapackId, name: pack.datapack_name ?? pack.name ?? datapackId };
    },
    async conversation_create({ runId, title }) {
      const result = await call('conversation_create', { session_id: runId, run_id: runId, title, agent_id: APP_AGENT });
      const id = result.conversation_id ?? result.id ?? result.conversation?.id;
      if (!id) throw new Error('Meko did not return a conversation ID.');
      return { id };
    },
    async context_search({ query, limit = 8, ...actor }) {
      const result = await call('context_search', { ...scope(actor), query, limit });
      const rows = result.results ?? result;
      const hits = bucket => Array.isArray(bucket) ? bucket : bucket?.results ?? bucket?.hits ?? [];
      if (!Object.hasOwn(rows, 'memory') && !Object.hasOwn(rows, 'knowledge_base') && !Object.hasOwn(rows, 'conversation')) {
        throw new Error('Meko context_search returned no source buckets.');
      }
      if ([rows.memory, rows.knowledge_base, rows.conversation].some(bucket => bucket?.error || bucket?.status === 'error')) {
        throw new Error('Meko context_search reported a failed source.');
      }
      return {
        memory: hits(rows.memory).map(hit => normalize(hit, 'memory')),
        knowledge: hits(rows.knowledge_base).map(hit => normalize(hit, 'knowledge')),
        conversation: hits(rows.conversation).map(hit => normalize(hit, 'conversation')),
      };
    },
    async memory_search({ query, limit = 8, ...actor }) {
      const result = await call('memory_search', { ...scope(actor), query, limit });
      if (!Array.isArray(result.results)) throw new Error('Meko memory_search returned no results array.');
      return { memory: result.results.map(hit => normalize(hit, 'memory')) };
    },
    async knowledgebase_search({ query, limit = 8, ...actor }) {
      const result = await call('knowledgebase_search', { ...scope(actor), query, limit });
      return { knowledge: (result.results ?? []).map(hit => normalize(hit, 'knowledge')) };
    },
    async memory_add({ record, ...actor }) {
      const result = await call('memory_add', { ...scope(actor), text: PREFIX + JSON.stringify(record),
        metadata: JSON.stringify({ kind: record.kind, topic: record.topic }) });
      const id = result.id ?? result.memory_id ?? result.results?.[0]?.id;
      if (!id) throw new Error('Meko did not return a stored memory ID.');
      return { id };
    },
    async track_token_usage({ conversationId, agent, messageId }) {
      await call('track_token_usage', { conversation_id: conversationId, message_id: messageId,
        name: agent, input_tokens: 0, output_tokens: 0, total_tokens: 0, model: 'deterministic-no-model' });
      return { recorded: true };
    },
    async artifact_put({ version, text, ...actor }) {
      const result = await call('artifact_put', { ...scope(actor), filename: `${version}.md`,
        content_type: 'text/markdown', content_base64: toBase64(text) });
      if (!result.content_hash) throw new Error('Meko did not return an artifact hash.');
      return { id: result.artifact_id ?? result.content_hash, hash: result.content_hash, version, text };
    },
    async artifact_get({ hash, ...actor }) {
      const result = await call('artifact_get', { ...scope(actor), content_hash: hash });
      return { id: result.artifact_id ?? hash, hash, version: result.filename?.replace(/\.md$/, ''),
        text: fromBase64(result.content_base64 ?? result.content_base64_large ?? '') };
    },
    async trace_record({ runId, conversationId, question, brief, events, metrics }) {
      const result = await call('conversation_add_message', {
        conversation_id: conversationId, agent_id: APP_AGENT, input: question, output: brief,
        seed: runId, plan: ['Retrieve existing context', 'Resolve and condense evidence', 'Draft and verify', 'Save the artifact'],
        metadata: JSON.stringify({ runId, events, metrics }),
      });
      return { id: runId, messageId: result.message_id ?? result.id ?? result.message?.id };
    },
    async trace_read({ runId, conversationId }) {
      const result = await call('conversation_get', { conversation_id: conversationId, agent_id: APP_AGENT, include_messages: true });
      for (const message of (result.conversation ?? result).messages ?? []) {
        const metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata) : message.metadata;
        if (metadata?.runId === runId) return { runId, events: metadata.events, metrics: metadata.metrics };
      }
      return null;
    },
    async browse({ conversationId, query }) {
      const result = await call('memory_get_all', { conversation_id: conversationId, agent_id: APP_AGENT, page: 1, page_size: 30 });
      const items = (result.memories ?? result.results ?? []).map(hit => normalize(hit, 'memory'));
      const { knowledge } = await this.knowledgebase_search({ conversationId, query });
      return { memories: items.filter(item => item.kind !== 'learning'), learnings: items.filter(item => item.kind === 'learning'), knowledge };
    },
  };
}
