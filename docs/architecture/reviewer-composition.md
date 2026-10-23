# Reviewer Composition, Routing, and Lifecycle (2026-10-15)

Moved verbatim from `memory-bank/systemPatterns.md` on 2026-10-23 (PR #92) so that file stays
under its CI line cap; it keeps a pointer here, right after its Agent Swarm section, which this
contract refines. Read this before adding, changing or retiring a reviewer or its prompt, adding
a policy or filter, or changing the orchestrator's fan-in.

Mined from Anthropic's public Small Business skill library as an architecture analogue, not as a
runtime dependency. The useful distinction is **composition role**:

- specialist review agents are **utilities** — each owns one bounded review lens and produces
  evidence in that lens;
- the `Orchestrator` is an **orchestrator** — it consumes specialist outputs, preserves their
  provenance, reconciles overlap, cross-references related findings, and produces the final review
  view.

This sharpens the existing Agent Swarm contract:

1. **The orchestrator must consume evidence, not silently redo the review.** It may synthesize,
   deduplicate, correlate, or add clearly-labelled inference, but it must not replace a specialist's
   evidence with an untraceable new conclusion. When facts disagree, preserve the disagreement and
   provenance rather than manufacturing consensus.
2. **Reviewer overlap must be deliberate.** If two reviewer prompts can both claim the same defect
   class, either define a clear ownership boundary/exclusion rule or explicitly treat the overlap as
   independent corroboration. Accidental routing collisions waste inference and make duplicate
   findings look like stronger evidence than they are.
3. **Orthogonal axes survive convergence.** Standards compliance, correctness, security,
   architecture, tests, and other independent questions are not interchangeable scores. Fan-in may
   connect them, but must not collapse them into one blended confidence before their individual
   evidence is visible.
4. **New or changed reviewers earn trust by replay.** Evaluate against cases with a known expected
   outcome/oracle before promoting the reviewer or prompt to the default set. A reviewer that only
   "looks reasonable" on fresh unknown cases has not established value.
5. **The reviewer set has a lifecycle.** Add a specialist only for a demonstrated coverage gap or
   materially useful independent lens. Measure overlap and yield; consolidate or retire reviewers
   that duplicate another lens without adding verified signal. Swarm size is not a quality metric.
6. **Stop at the decision boundary.** ACR gathers, checks, ranks, explains, and recommends. It does
   not merge, rewrite the reviewed code, or weaken its own review requirement to reach a clean
   verdict. Consequential action stays with the human/workflow that owns it.

**Routing-collision audit:** whenever a new specialist, policy, or filter is added, compare its
positive trigger/claim space against every existing reviewer. If an ordinary finding could
reasonably be owned by more than one agent, document whether that is intentional corroboration or a
boundary defect and test the chosen behavior in calibration.
