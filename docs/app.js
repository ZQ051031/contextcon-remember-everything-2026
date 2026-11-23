import { createMekoClient } from './meko-client.js';
import { agents, compareResearch } from './research.js';
import { topics } from './topics.js';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const labels = ['Find evidence', 'Condense findings', 'Draft the brief', 'Verify and measure'];
const client = createMekoClient();
const api = name => new URL(`./api/${name}`, location.href);
const localBridge = location.protocol === 'http:' && location.hostname === '127.0.0.1' && location.port === '8077';
let configuration = { mode: 'demo' }, history = [], last, downloadUrl;
let collection = await client.browse();
if (localBridge) {
  try {
    const response = await fetch(api('status'));
    if (response.ok) configuration = await response.json();
  } catch { /* A plain static server does not supply the live adapter. */ }
}
if (configuration.mode === 'live') {
  $('mode-label').textContent = 'Live Meko mode';
  collection = { memories: [], learnings: [], knowledge: [] };
  $('status').textContent = 'Live mode writes questions and runs to your Meko datapack. Use synthetic data only.';
}
for (const topic of topics) {
  const button = node('button', topic.question);
  button.type = 'button';
  button.addEventListener('click', () => { $('question').value = topic.question; $('question').focus(); });
  $('examples').append(button);
}

function pipeline(active, completed = false) {
  const index = agents.indexOf(active);
  $('pipeline').replaceChildren(...agents.map((agent, i) => {
    const item = node('li');
    item.dataset.state = completed || i < index ? 'done' : i === index ? 'active' : 'pending';
    const label = node('div');
    label.append(node('strong', agent), node('small', `${labels[i]} · ${item.dataset.state === 'done' ? 'done' : item.dataset.state === 'active' ? 'running' : 'ready'}`));
    item.append(node('span', `0${i + 1}`, 'step'), label);
    return item;
  }));
}

function renderMemory() {
  const kind = $('memory-kind').value;
  const rows = collection[kind];
  $('memory-list').replaceChildren(...(rows.length ? rows.map(item => {
    const box = node('article', undefined, 'memory-item');
    box.append(node('strong', item.title), node('p', item.text), node('small', item.id, 'muted'));
    return box;
  }) : [node('p', 'No entries in this view yet.', 'empty')]));
}

const relevance = score => Number.isFinite(score) ? score.toFixed(2) : 'score unavailable';

function renderTrace() {
  if (!last) return;
  const run = last[$('trace-mode').value];
  $('retrieved').replaceChildren(...run.retrievals.map(({ agent, hits }, index) => {
    const group = node('details');
    group.open = index === 0;
    group.append(node('summary', `${agent} · ${hits.length} hits`));
    if (!hits.length) group.append(node('p', run.mode === 'baseline' ? 'No datapack lookup in full replay.' : 'No matching datapack records.', 'empty'));
    for (const hit of hits) {
      const row = node('div', undefined, 'hit');
      row.append(node('span', `${hit.kind} · ${relevance(hit.score)} · ${hit.id ?? 'unlabelled'}`),
        node('p', hit.title), node('p', hit.text));
      group.append(row);
    }
    return group;
  }));
  $('trace').replaceChildren(...run.trace.map(event => {
    const row = node('li');
    const counts = event.type === 'tokens' ? ` [${event.inputTokens} in / ${event.outputTokens} out]` : '';
    const ref = event.id ? ` · ${event.id}` : '';
    row.append(node('strong', `${event.agent} · ${event.type} · `),
      document.createTextNode(event.detail + counts + ref), node('span', ` · ${event.elapsedMs.toFixed(1)} ms`, 'muted'));
    return row;
  }));
}

function renderResult() {
  const { shared, baseline, tokenReduction } = last;
  $('delta').textContent = `${Math.abs(tokenReduction).toFixed(1)}% ${tokenReduction >= 0 ? 'fewer' : 'more'} estimated tokens`;
  for (const [mode, run] of Object.entries({ shared, baseline })) {
    $(`${mode}-tokens`).textContent = run.metrics.tokens.toLocaleString('en-US');
    $(`${mode}-latency`).textContent = `${run.metrics.latencyMs.toFixed(1)} ms`;
    $(`${mode}-quality`).textContent = run.metrics.quality === null ? 'Not scorable' : `${run.metrics.quality}%`;
  }
  $('datapack-label').textContent = shared.datapack.name;
  $('brief').textContent = shared.brief;
  $('artifact').textContent = `${shared.version} · SHA-256 ${shared.artifact.hash}`;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([shared.artifact.text], { type: 'text/markdown' }));
  $('download').href = downloadUrl;
  $('download').download = `${shared.version}.md`;
  $('download').hidden = false;
  $('trace-mode').value = 'shared';
  renderTrace();
  renderMemory();
  const average = shared.metrics.meanRelevance;
  $('status').textContent = `Complete · ${shared.metrics.reused} verified reuses · mean retrieved relevance ${relevance(average)}.`;
}

$('memory-kind').addEventListener('change', renderMemory);
$('trace-mode').addEventListener('change', renderTrace);
$('ask').addEventListener('submit', async event => {
  event.preventDefault();
  const question = $('question').value.trim();
  if (!question || $('run').disabled) return;
  $('run').disabled = $('question').disabled = true;
  $('status').classList.remove('error');
  $('status').textContent = 'Running both modes…';
  pipeline();
  try {
    if (configuration.mode === 'live') {
      const response = await fetch(api('run'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      ({ comparison: last, collection } = result);
    } else {
      last = await compareResearch(question, { client, history, progress: agent => pipeline(agent) });
      collection = await client.browse();
      history.push(last.baseline.historyEntry);
    }
    pipeline(undefined, true);
    renderResult();
  } catch (error) {
    $('status').classList.add('error');
    $('status').textContent = `Run failed: ${error.message}`;
    pipeline();
  } finally {
    $('run').disabled = $('question').disabled = false;
  }
});
pipeline();
renderMemory();
