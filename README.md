# ContextCon Research Collective

**Challenge 8 — Do More with Fewer Tokens**, supported by **Challenge 7 — Traceability** and **Challenge 2 — Shared Learning**. A four-agent research workspace that compares selective retrieval with full-history replay on the same task.

## Run the offline demo

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/). Click a seeded question, then **Run comparison**. Run it again without refreshing: the Researcher, Summariser, Writer, and Analyst can reuse the previous run's records. Open the agent groups under **Retrieved context** and choose **Verified learnings** in the datapack browser. In **Decision trace**, switch to **Full replay** to see why the baseline has no retrieval scores. The brief can be downloaded as Markdown; the run shows its version and content hash.

No account, build step, npm install, or network API is needed. Demo data lives only in the current tab; a page reload resets it. Seed topics cover shared memory, token-efficient retrieval, Meko datapacks, traces, learnings, and artifact versioning. Related queries can match the same seed; a question without seeded evidence receives an explicit evidence-gap brief rather than fabricated findings.

## Architecture

```text
                             ┌──────────── same question ─────────────┐
                             │                                         │
Shared pathway      retrieve first → Researcher → Summariser → Writer → Analyst
                             ↕              ↕           ↕         ↕         ↕
                     One Meko datapack: records · scores · conversation · artifact
Full replay         replay corpus, prior runs and current handoffs for every agent
                     Same fixtures and brief/coverage rules; no datapack operations
```

| Component | Responsibility |
| --- | --- |
| Researcher | Search before reading new notes; keep source facts and stable IDs. |
| Summariser | Reuse the source handoff or an existing digest; save a compact, cited summary. |
| Writer | Reuse digest and verified learning; draft an immutable Markdown version. |
| Analyst | Check fact/citation pairs against fixtures, record relevance and estimated context size, and save a learning only when all facts are covered. |

`docs/research.js` is the same deterministic pipeline in the browser, tests, benchmark, and optional Live Meko adapter. No language model is called. Records are shared by all four agents under one identity and datapack, with agent IDs used for attribution. App learnings are durable across live runs and shared across this app's agents, not automatically promoted to other Meko accounts. Provenance checks reject stale or altered source records.

### Meko integrations

| Tool / operation | Role |
| --- | --- |
| `datapack_describe`, `conversation_create` | Scope operations to one explicit datapack and link each run's conversation. |
| `context_search`, `memory_search` | Search before each agent's work; show normalized memory, knowledge and conversation hits with 0–1 relevance when the source supplies it. Demo ranking uses cosine overlap of token sets. |
| `memory_add` | Save Researcher findings, Summariser digests and Analyst-verified practices with source IDs. |
| `memory_get_all`, `knowledgebase_search` | Browse the latest live memories and learnings plus matching knowledge chunks. Demo browsing shows the whole synthetic collection; live search sees knowledge already present in the chosen datapack. The bundled corpus is a local research fallback; the app does not upload it. |
| `artifact_put`, `artifact_get` | Store and look up the exact brief by SHA-256; an independent run version is embedded in the filename and the bytes. Free-plan artifacts can expire after 30 days without access. |
| `conversation_add_message`, `conversation_get` | Persist/read the app decision trace in a conversation turn's metadata; Meko separately observes live tool activity. The trace contains operations and rationale summaries, not private reasoning. |
| `track_token_usage` | Record zero *model* tokens if the service accepts the observation. Estimated context and output sizes are stored separately in trace metadata, never sent as model usage. An unavailable usage observation is shown as a warning. |

See the [Meko MCP reference](https://docs.mekodata.ai/reference/mcp-server/) and [Datapack API](https://docs.mekodata.ai/reference/datapack-api/). The authenticated Cloud flow was not exercised: initialization/headers, exact Cloud payloads, indexing of new memory, trace metadata and usage permissions must be checked with a real key. Automated transport tests use mock responses. Browser access to the remote MCP endpoint was rejected at preflight (`Forbidden: origin not allowed`), so the public static app is demo-only, and Live Meko uses a loopback adapter. The adapter forwards no browser credentials, keeps the Meko key server-side, and does not require a hosted backend.

## Use Live Meko locally

1. Create a free account at [cloud.mekodata.ai](https://cloud.mekodata.ai/) and create **one** datapack for the project. The free plan requires no credit card and includes **10 datapacks** and **100 MB knowledge**.
2. Create an API key under **Settings → API Keys** with access to read and write in that datapack. Copy `config/meko.config.example.json` to `config/meko.config.json`, then paste the key into `apiKey` and set `datapackId`. Alternatively, set `MEKO_API_KEY` and `MEKO_DATAPACK_ID` in your shell. Shell values take precedence. Do not put a key inside `docs/` or commit it; the local config file and `.env` are ignored.
3. From the repository root, (re-)run `node scripts/live-server.mjs` with Node.js 22+, then open **[http://127.0.0.1:8077/](http://127.0.0.1:8077/)**. Look for **Live Meko mode**. Without a key, the same command automatically serves **Demo mode**. Only use synthetic inputs in the live datapack.

## Tests and measured benchmark

```sh
node --test tests/*.test.mjs
node scripts/benchmark.mjs
```

The benchmark primes each of the six questions once, then measures two paired passes of the **same** six questions (12 runs per mode). It uses offline demo memory only. Both modes begin each measured pair with equivalent prior question history; the full-replay path reads all seeded notes, prior runs, and each run's accumulated handoffs at every stage, while shared memory admits only selected stage context. The warm-up runs are excluded from the table. Re-running writes [docs/metrics.json](docs/metrics.json) and refreshes the table below.

- **Estimated tokens:** breaks text into words/numbers and punctuation, then sums one token per four UTF-16 code units (rounded up per piece). This is a proxy for model context plus output, not network bytes, actual billed tokens, or a specific model's tokenizer.
- **Latency:** wall-clock time from run start through the analysis/coverage step; excludes writes after the brief is ready (artifact/trace/usage) and browser rendering. This is a local heuristic workload, not a measure of hosted Meko latency.
- **Coverage:** percent of expected fixture facts that appear with the correct source ID; not human-rated quality. **Relevance:** mean score across retrieved results with a numeric score; not comparable with full replay, which doesn't rank results.

<!-- benchmark:start -->
| Mode | Runs | Mean estimated tokens | Mean time to brief | Mean coverage | Mean relevance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shared memory (demo, warm) | 12 | 1009.8 | 0.474 ms | 100.0% | 0.234 |
| Full-history replay | 12 | 50474.3 | 2.063 ms | 100.0% | — |

Mean estimated token reduction: **98.0%** on this run.
<!-- benchmark:end -->

## GitHub Pages

Pages could not be enabled via the GitHub API (`403: Resource not accessible by integration`). A repository administrator can enable the static demo:

1. Once the app is on `main`, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **main** and **/docs**, then click **Save**. After GitHub finishes deploying, open [the expected demo URL](https://zq051031.github.io/contextcon-remember-everything-2026/).

## Submission materials

- [Demo script](DEMO_SCRIPT.md) — under five minutes, with exact narration.
- [Presentation outline](PRESENTATION.md) — eleven slides.
- Remaining manual steps: enable Pages after the work is on main, optionally create a free Meko account to verify Live mode, record the demo, and submit on [HackerEarth](https://www.hackerearth.com/community/challenges/hackathon/contextcon-remember-everything/).
