# Submission presentation · 11 slides

1. **ContextCon Research Collective** — Challenge 8: Do More with Fewer Tokens. One datapack, four agents, two ways to run the same task.
2. **Problem** — Full history is easy to replay and expensive to carry; it obscures what actually informed a decision.
3. **Approach** — Retrieve first, pass cited handoffs, and save compact records for the next run.
4. **Architecture** — Researcher → Summariser → Writer → Analyst. Every stage searches the same datapack; demo and live use the same interface.
5. **Meko integration** — Scoped context and memory search, durable writes, conversation trace, and content-addressed artifacts.
6. **Demo: first run** — A seeded question goes through both modes. Inspect per-agent retrieval and open the output artifact.
7. **Demo: second run** — Repeat the question; inspect reuse and the verified learning in the shared-memory browser (Challenge 2).
8. **Traceability** — Show agent, tool, relevance, write, estimated tokens, and the brief version (Challenge 7).
9. **Measured results** — Display the generated [README table](README.md#tests-and-measured-benchmark). Explain warm-up, the token proxy, time to brief, and fixture coverage.
10. **Limits** — Synthetic facts, no model or billed token data, no live numbers without authenticated verification. Relevance is not correctness.
11. **What’s next** — Verify hosted behavior with a free datapack, broaden the evaluation corpus, and assess evidence coverage with a human rubric.
