import assert from 'node:assert/strict';
import test from 'node:test';
import { createMekoClient } from '../docs/meko-client.js';
import { topics } from '../docs/topics.js';

test('no API key uses demo without network; search relevance and memory_add round-trip', async () => {
  const demo = createMekoClient({ fetcher: () => assert.fail('demo must not use network') });
  assert.equal(demo.mode, 'demo');
  assert.match((await demo.datapack_describe()).id, /demo/);
  const record = { title: 'Grounding', topic: 'shared-memory', kind: 'sources', text: 'Unique phrase: provenance ledger' };
  const other = { ...record, title: 'One workspace', text: 'Datapack boundaries' };
  await demo.memory_add({ agent: 'Writer', record: other });
  const { id } = await demo.memory_add({ agent: 'Researcher', record });
  const { memory } = await demo.memory_search({ agent: 'Writer', query: 'provenance ledger' });
  assert.equal(memory[0].id, id);
  assert.equal(memory[0].text, record.text);
  assert.ok(memory[0].score > 0 && memory[0].score <= 1);
  const { knowledge } = await demo.knowledgebase_search({ query: topics[0].title, limit: 3 });
  assert.equal(knowledge.length, 3);
  assert.ok(knowledge.every(hit => hit.topic === topics[0].id));
});

test('live and demo expose the same methods and live issues documented scoped MCP calls', async () => {
  let storedText, storedArtifact, storedMetadata;
  const liveCalls = [];
  const actor = { conversationId: 'conversation-1', agent: 'Writer' };
  const mockKey = 'offline-test-fixture';
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://mcp.mekodata.ai/mcp');
    assert.equal(options.headers.Authorization, `Bearer ${mockKey}`);
    assert.equal(options.headers['User-Agent'], 'contextcon-research-collective/1.0');
    const { method, id, params } = JSON.parse(options.body);
    const result = (payload, headers) => Response.json({ jsonrpc: '2.0', id, result: payload }, { headers });
    if (method === 'initialize') return result({ protocolVersion: '2025-03-26' }, { 'mcp-session-id': 'session-1' });
    assert.equal(options.headers['Mcp-Session-Id'], 'session-1');
    assert.equal(options.headers['MCP-Protocol-Version'], '2025-03-26');
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(method, 'tools/call');
    const { name, arguments: args } = params;
    assert.equal(args.datapack_id, 'one-pack');
    liveCalls.push(name);
    if (name === 'datapack_describe') return result({ structuredContent: { datapack_id: 'one-pack', datapack_name: 'Test pack' } });
    if (name === 'conversation_create') return result({ structuredContent: { id: actor.conversationId } });
    assert.equal(args.conversation_id, actor.conversationId);
    const memory = () => ({ id: 'memory-1', memory: storedText, score: 0.8 });
    const chunk = { id: 'chunk-1', chunk_text: 'fixture', distance: 0.2 };
    const responses = {
      memory_add: () => { storedText = args.text; return { results: [{ id: 'memory-1' }] }; },
      memory_search: () => ({ results: [memory()] }),
      context_search: () => ({ results: { memory: [memory()], knowledge_base: [chunk], conversation: { hits: [] } } }),
      memory_get_all: () => ({ memories: [memory()] }),
      knowledgebase_search: () => ({ results: [chunk] }),
      artifact_put: () => { storedArtifact = args; return { artifact_id: 'artifact-1', content_hash: 'hash-1' }; },
      artifact_get: () => ({ artifact_id: 'artifact-1', filename: storedArtifact.filename, content_base64: storedArtifact.content_base64 }),
      conversation_add_message: () => { storedMetadata = args.metadata; return { id: 'message-1' }; },
      conversation_get: () => ({ messages: [{ metadata: storedMetadata }] }),
      track_token_usage: () => {
        assert.equal(args.total_tokens, 0);
        assert.equal(args.message_id, 'message-1');
        return { recorded: true };
      },
    };
    const payload = { content: [{ type: 'text', text: JSON.stringify(responses[name]()) }] };
    if (name === 'context_search') {
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: payload })}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return result(payload);
  };
  const live = createMekoClient({ apiKey: mockKey, datapackId: 'one-pack', fetcher });
  assert.equal(live.mode, 'live');
  assert.deepEqual(Object.keys(live).sort(), Object.keys(createMekoClient()).sort());
  assert.deepEqual(await live.datapack_describe(), { id: 'one-pack', name: 'Test pack' });
  assert.deepEqual(await live.conversation_create({ runId: 'run-1', title: 'Test' }), { id: actor.conversationId });
  const record = { kind: 'learning', text: 'Test facts', title: 'Test learning', topic: 'shared-memory' };
  assert.deepEqual(await live.memory_add({ ...actor, record }), { id: 'memory-1' });
  const context = await live.context_search({ ...actor, query: 'facts' });
  assert.equal(context.memory[0].kind, 'learning');
  assert.equal(context.knowledge[0].score, 0.8);
  assert.equal((await live.memory_search({ ...actor, query: 'facts' })).memory[0].score, 0.8);
  assert.equal((await live.browse({ ...actor, query: 'facts' })).learnings[0].text, record.text);
  const details = { ...actor, version: 'brief-v-1', text: 'Résumé · 研究' };
  const artifact = await live.artifact_put(details);
  assert.deepEqual(await live.artifact_get({ ...actor, hash: artifact.hash }), artifact);
  const events = [{ type: 'retrieval' }], metrics = { tokens: 14 };
  const trace = { runId: 'run-1', events, metrics };
  const { messageId } = await live.trace_record({ ...actor, ...trace, question: 'facts', brief: 'answer' });
  assert.deepEqual(await live.trace_read({ ...actor, runId: trace.runId }), trace);
  assert.deepEqual(await live.track_token_usage({ ...actor, messageId, ...metrics }), { recorded: true });
  assert.equal(liveCalls.length, 12);
});

test('client refuses invalid live config and does not misreport MCP errors as empty search', async () => {
  assert.throws(() => createMekoClient({ apiKey: 'offline-key' }), /DATAPACK_ID/);
  const live = createMekoClient({ apiKey: 'offline-key', datapackId: 'demo', fetcher: async (url, { body }) => {
    const { id, method } = JSON.parse(body);
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = method === 'initialize' ? {} : { isError: true, content: [{ type: 'text', text: 'unavailable' }] };
    return Response.json({ jsonrpc: '2.0', id, result });
  } });
  await assert.rejects(live.memory_search({ query: 'test' }), /Meko tool memory_search failed/);
});
