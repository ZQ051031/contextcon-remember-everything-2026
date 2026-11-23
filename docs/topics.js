const seeds = [
  ['shared-memory', 'How does shared memory help multi-agent systems?', 'Shared memory in multi-agent systems',
    'Share verified records, not just more records.',
    ['Scoped handoff', 'A shared datapack lets agents pass findings by reference.', 'The prototype put retrieval and writing in separate stages. Agents did not need to know where the preceding stage executed.'],
    ['Provenance', 'Source IDs help agents distinguish evidence from prior drafts.', 'The review team compared retained citations with a small seeded source ledger.'],
    ['Namespace boundary', 'Scope reads and writes to the intended datapack.', 'Placement checks were performed with synthetic collections and did not test access control at scale.']],
  ['token-retrieval', 'How can retrieval reduce context tokens without losing quality?', 'Token-efficient retrieval and context budgets',
    'Track evidence coverage alongside the size of selected context.',
    ['Bounded shortlist', 'Rank and cap the evidence admitted into each agent prompt.', 'The team compared several shortlist sizes and checked whether low-ranked items repeated concepts.'],
    ['Explicit baseline', 'Compare against the same task with full-history replay.', 'Both settings used the same output rules and fact checklist. Only the method of supplying evidence differed.'],
    ['Recall cost', 'A smaller context can omit a necessary fact.', 'Inspect evidence coverage first and use the source corpus on a miss.']],
  ['datapacks', 'How should agents use Meko datapacks for shared research?', 'Meko datapacks for shared research',
    'Keep searchable records separate from versioned output files.',
    ['One workspace', 'A datapack groups memory, knowledge, and conversations in one workspace.', 'The example assigned all stages the same workspace ID and used separate labels for attribution.'],
    ['Search first', 'Agents should retrieve existing context before writing new findings.', 'The team treated weak scores as guidance, not proof, and checked provenance before reuse.'],
    ['Artifact boundary', 'Store exact brief bytes as an artifact and keep its content hash.', 'The review handoff included a version label and the returned storage reference.']],
  ['traces', 'What belongs in an auditable agent decision trace?', 'Auditable agent decision traces and provenance',
    'Record observable decisions and effects rather than private reasoning.',
    ['Action record', 'Log the agent, tool, and result for each retrieval or write.', 'The test dashboard distinguished tool calls from internal decisions in both display modes.'],
    ['Evidence trail', 'Keep retrieved scores and provenance next to the decision.', 'The review checked whether a later reader could reconstruct what was reused and why.'],
    ['Measurement', 'Attach token-accounting method and timing to the run.', 'Estimated prompt sizes were labeled separately from billed usage.']],
  ['learnings', 'How can agents verify and reuse durable learnings?', 'Verified durable learnings for shared agents',
    'Save a learning only once its supporting records can be identified.',
    ['Grounding', 'Verify a learning against source IDs before saving it.', 'A synthetic reviewer checked every cited sentence against the curated fixture text.'],
    ['Version awareness', 'Recheck a recalled learning if its source set changes.', 'The sandbox represented updates with independent versions and no automatic overwrite.'],
    ['Safe reuse', 'Treat relevance as a retrieval signal, not factual verification.', 'A close textual match was inspected before it was admitted to the final draft.']],
  ['artifacts', 'How do versioned artifacts improve research reproducibility?', 'Versioned research artifacts and reproducibility',
    'Version each output independently of the current contents of shared memory.',
    ['Stable output', 'Save each final brief with its own immutable version label.', 'The sample output contained a run identifier and did not depend on a mutable latest alias.'],
    ['Artifact lookup', 'Use the artifact hash to retrieve the exact stored bytes.', 'The reviewer compared the returned bytes with the rendered brief rather than regenerating it.'],
    ['Reproducible citations', 'Carry evidence identifiers into the stored output.', 'The brief could be audited even after the workspace accumulated unrelated runs.']],
];

export const topics = seeds.map(([id, question, title, learning, ...rows]) => ({
  id, question, title, learning,
  sources: rows.map(([label, fact, notes], index) => ({
    id: `${id}-${index + 1}`, title: label, topic: id, kind: 'knowledge', fact,
    text: `Synthetic research note · ${title} · ${label}. Finding: ${fact} Notes: ${notes} Scope: seeded demonstration only; no independent production finding is asserted.`,
  })),
}));

export const knowledge = topics.flatMap(topic => topic.sources);

const stop = new Set('a an and are against as be before by can do for from how in is it of on or should than the their to use was what when where which with without'.split(' '));
export function terms(text) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(word => word.replace(/(?<=.{3})s$/, '')).filter(word => !stop.has(word)));
}

export function relevance(query, document) {
  return termRelevance(terms(query), terms(document));
}

export function termRelevance(a, b) {
  if (!a.size || !b.size) return 0;
  return [...a].filter(word => b.has(word)).length / Math.sqrt(a.size * b.size);
}

export function selectTopic(question) {
  return topics.map(topic => ({ topic, score: relevance(question, `${topic.question} ${topic.title}`) }))
    .sort((a, b) => b.score - a.score).find(result => result.score >= 0.22)?.topic;
}
