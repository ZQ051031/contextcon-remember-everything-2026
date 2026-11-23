import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createMekoClient } from '../docs/meko-client.js';
import { compareResearch } from '../docs/research.js';

const root = new URL('../docs/', import.meta.url);
const host = '127.0.0.1', port = 8077, origin = `http://${host}:${port}`;
let config = {};
try {
  config = JSON.parse(await readFile(new URL('../config/meko.config.json', import.meta.url), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('config/meko.config.json must be valid JSON.');
}
const client = createMekoClient({ apiKey: process.env.MEKO_API_KEY || config.apiKey,
  datapackId: process.env.MEKO_DATAPACK_ID || config.datapackId });
const history = [];
const mime = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json' };
let busy = false;
function reply(response, status, value, type = 'application/json') {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
  response.end(type === 'application/json' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
}
createServer(async (request, response) => {
  if (request.headers.host !== `${host}:${port}` || (request.headers.origin && request.headers.origin !== origin)) {
    return reply(response, 403, { error: 'Only same-origin loopback requests are accepted.' });
  }
  const path = new URL(request.url, origin).pathname;
  if (path === '/api/status' && request.method === 'GET') return reply(response, 200, { mode: client.mode });
  if (path === '/api/run' && request.method === 'POST' && client.mode === 'live') {
    if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
      return reply(response, 403, { error: 'This route requires same-origin JSON.' });
    }
    if (busy) return reply(response, 409, { error: 'A run is already in progress.' });
    busy = true;
    try {
      let body = '';
      request.setEncoding('utf8');
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) break;
      }
      let question;
      try { ({ question } = JSON.parse(body)); } catch { /* Validated below. */ }
      if (typeof question !== 'string' || !question.trim() || question.length > 500) {
        return reply(response, 400, { error: 'Enter a question up to 500 characters.' });
      }
      const comparison = await compareResearch(question, { client, history });
      history.push(comparison.baseline.historyEntry);
      const { conversationId } = comparison.shared;
      const collection = await client.browse({ conversationId, query: question }).catch(() => null);
      if (!collection) {
        const previous = comparison.shared.trace.at(-1);
        comparison.shared.trace.push({ step: previous.step + 1, agent: 'Pipeline', type: 'warning',
          detail: 'Meko memory browser lookup failed.', elapsedMs: previous.elapsedMs });
      }
      return reply(response, 200, { comparison, collection: collection ?? { memories: [], learnings: [], knowledge: [] } });
    } catch (error) {
      const message = error.message.startsWith('Meko ') ? error.message : 'Live Meko request failed; check connectivity and configuration.';
      return reply(response, 502, { error: message });
    } finally { busy = false; }
  }
  const file = path === '/' ? 'index.html' : path.slice(1);
  const match = /^[a-z][a-z0-9-]*\.(html|css|js|json)$/.exec(file);
  if (request.method === 'GET' && match) {
    try { return reply(response, 200, await readFile(new URL(file, root)), mime[match[1]]); }
    catch { /* Not an app asset. */ }
  }
  reply(response, 404, { error: 'Not found.' });
}).listen(port, host, () => console.log(`Research Collective (${client.mode}): ${origin}/`));
