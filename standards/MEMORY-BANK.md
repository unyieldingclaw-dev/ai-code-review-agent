# Memory Bank Standard

A structured system for maintaining persistent project context across AI coding sessions.

## Overview

The Memory Bank pattern solves the "context amnesia" problem in AI-assisted development. Instead of re-explaining your project every session, you maintain structured files that AI reads automatically.

## File Structure

```
memory-bank/
├── projectbrief.md      # Non-negotiable requirements (rarely changes)
├── systemPatterns.md    # Architecture decisions, code patterns
├── techContext.md       # Tech stack, dependencies, environment
├── activeContext.md     # Current focus, recent decisions
└── progress.md          # Completed, in-progress, planned work
```

## File Purposes

### projectbrief.md
**The "constitution" of your project** - fundamental requirements that rarely change.

Contains:
- Core business purpose and goals
- Non-negotiable constraints (performance, compliance, technical)
- Success metrics
- Key stakeholders

Update when: Core requirements change (rare)

### systemPatterns.md
**Established architectural patterns** that AI must follow.

Contains:
- Architecture decisions (microservices, monolith, etc.)
- Code patterns (error handling, async patterns, etc.)
- Frontend patterns (state management, styling, etc.)
- "Never do this" rules
- Testing patterns

Update when: New patterns established, anti-patterns discovered

### techContext.md
**Complete technical environment** specification.

Contains:
- Development environment (OS, IDE, tools)
- Backend stack (languages, frameworks, databases)
- Frontend stack (frameworks, build tools, UI libraries)
- Infrastructure (Docker, services, ports)
- External service constraints

Update when: Dependencies change, services added, config updated

### activeContext.md
**Current session state** - what you're working on right now.

Contains:
- Current focus area
- Recent decisions made this session
- Next steps (priority ordered)
- Known issues and blockers
- Environment status (running services, git state)

Update when: Every session, when focus changes, at milestones

### progress.md
**Project-wide progress tracker**.

Contains:
- Completed features (checked off)
- In-progress work
- Planned work (backlog)
- Known bugs
- Version history

Update when: Features completed, bugs found, milestones reached

**Does NOT contain: a restatement of the change itself.** This is the binding constraint on
memory-bank size, and it is a write-RATE rule, not an eviction rule. A commit message is permanent,
searchable, and costs zero context; a `progress.md` entry costs context at every session start and
again after every compaction, forever. The test for a new entry is therefore: *could a commit
message have carried this?* If yes, it belongs there, and the entry cites the hash instead.

Record what a commit message structurally cannot:
- Cross-session state — what is in flight, blocked, or deferred, and why
- Decisions whose rationale outlives the commit that implemented them
- **Corrections to earlier entries** — a commit message is immutable, so a claim that turns out
  wrong can only be superseded here
- Findings that span commits, or that no single commit caused

Do not record: what changed, which files were touched, suite counts, or a review's findings list
when the commit message already carries them.

**Why this outranks eviction.** `progress.md` was measured growing **+24,355 bytes in 3 days** while
`docs/archive/` already held **182,555 bytes** (measured at `22549c4`; an earlier draft of this
paragraph cited a four-day-stale 149,711) moved out by the eviction mechanism below — eviction
could not keep pace with the write rate, so it is symptom relief and this is the cause.

## Authority Tiers

Memory Bank files have explicit authority levels. When an agent encounters a contradiction
between files, the higher-tier file governs. The agent must surface the conflict and ask
the user to resolve it before changing a higher-tier decision.

| Tier | Level | Files | Behavior |
|------|-------|-------|----------|
| 1 | IMMUTABLE | projectbrief.md | Never negotiated; overrides all other files |
| 2 | STABLE | systemPatterns.md, techContext.md | Change requires deliberate decision + user confirm |
| 3 | VOLATILE | activeContext.md | Session state; evict stale content weekly |
| 4 | ACCUMULATING | progress.md | Archive to flat `docs/archive/` with date-prefixed filenames |

**Conflict resolution:** `projectbrief.md` > `systemPatterns.md` / `techContext.md` >
`activeContext.md` > `progress.md`. Agents must not silently reconcile contradictions —
they must flag them.

## Frontmatter Schema

Every memory-bank file carries YAML frontmatter with two groups of fields:

**Governance fields** (authority, freshness, retrieval):
```yaml
authority: immutable        # immutable | stable | volatile | accumulating
review-cycle: never         # never | 7d | 30d | 90d
retention: permanent        # permanent | archive-after-6m | archive-after-1y
staleness-threshold: 365d   # age after last-reviewed before mb doctor flags [STALE]
tags:
  - requirements/core
last-reviewed: YYYY-MM-DD
```

**Provenance fields** (compaction lineage and confidence):
```yaml
compaction_generation: 0    # 0=human-authored, 1=first AI summary, 2+=risk increases
source_type: canonical      # canonical | compacted | derived
confidence: high            # high | medium | low — proxy for generation + lineage coherence
lineage: []                 # additive chain of all ancestor files (empty for canonical)
```

### Compaction generation thresholds

| Generation | Status | Meaning |
|------------|--------|---------|
| 0 | Healthy | Human-authored canonical source |
| 1 | Healthy | First AI summary — still trustworthy |
| 2 | Caution | Recursive abstraction risk |
| 3+ | Degraded | Regenerate from lower-generation sources |
| 5+ | Unreliable | Likely information loss; do not trust without verification |

When `mb clean` rewrites a file, increment `compaction_generation` and add parent files to `lineage`.
Use git commit refs for verifiability: `activeContext.md@a81d2f`.

**Note on field orthogonality:** `source_type` (origin) and `compaction_generation` (transformation
depth) are correlated now but will diverge as the system matures. A human-edited synthesis of
multiple sources is `source_type: synthesized, compaction_generation: 0`. A file regenerated
from scratch after lineage collapse is `source_type: canonical, compaction_generation: 2`. Do not
treat them as a single axis. `authority:` is the third dimension and already exists as a separate
field — do not conflate it with either.

**Lineage must be additive, not replacement.** Every ancestor stays in the chain so trust
can be traced back to canonical sources. Replacement lineage loses the chain after two
generations; additive lineage enables partial reconstruction and canonical-source absence
detection.

`mb doctor` runs integrity heuristics against these fields:
- Warns when any file reaches generation ≥ 2
- Warns when lineage entries reference files that no longer exist (canonical-source absence)

## File Size Guidelines

Keep Memory Bank files focused and scannable:

| File | Target | Max | If Exceeded |
|------|--------|-----|-------------|
| projectbrief.md | 50-80 lines | 120 | Review - should rarely grow |
| systemPatterns.md | 100-180 lines | 300 | Consolidate similar patterns |
| techContext.md | 150-250 lines | 300 | Move details to docs/ |
| activeContext.md | 50-100 lines | 150 | Archive to `docs/archive/` |
| progress.md | 100-250 lines | 600 | Archive old versions |

**These numbers are not free-standing.** They restate the `FAIL` caps enforced by the size workflow
in `.github/workflows/`, and a table that drifts from the workflow tells a reader the opposite of
what CI will do. Two rows were already divergent before 2026-08-30 (`projectbrief` said 150 against
a workflow value of 120; `techContext` said 400 against 300) with nothing comparing them — this was
the FOURTH uncompared statement of the same caps. Change the workflow first, then this table.

## Eviction Criteria

Content should leave Memory Bank files on objective criteria, not agent judgment.

| File | Condition | Action |
|------|-----------|--------|
| activeContext.md | Entry > 14 days old and not an active blocker | Move to `docs/archive/context-YYYY-MM-<topic>.md` |
| activeContext.md | "Next Steps" item completed | Move to `progress.md` immediately |
| activeContext.md | Issue marked resolved | Delete — do not archive |
| progress.md | Entry's work is complete AND every live `[NS-N]` citation to it still resolves after the move — verified by `grep`, not assumed | Move **verbatim** to a bounded destination — either a write-once archive file per Archive Structure, or, if the destination is a living document that gets appended to, one with a size cap registered in your memory-bank size workflow (this template ships `.github/workflows/memory-bank-size.yml`; PMB's own copy of this rule names `pmb-health.yml`) — leaving a dated pointer that carries the original heading text |
| progress.md | Content is not chronological progress at all (project description, feature inventory, standing pointers) and has no live citation | Move **verbatim** to `docs/archive/progress-reference-sections-YYYY-MM-DD.md`, leaving a pointer |

**Why neither progress.md row is an age test — amended 2026-08-27, with the proof recorded.** Both
rows were age-based until this date (>6 months for completed work, >3 months for fixed bugs). They
were removed because they had **never once fired and could not**: this repo was 4 months old on
2026-08-27 (first commit 2026-04-29), so no content had ever reached the six-month threshold, while
`progress.md` was measured growing **+24,355 bytes over 3 days** (35,640 B at `ea862e8` → 59,995 B
at `030662c`). A repo that fills its cap in three days cannot be governed by a six-month eviction
clock. The gap was not theoretical: four separate cap-relief passes (`8847714`, `da62ad2`, the
reverted 2026-08-25 pass, and the 2026-08-26 rounds-4-9 relocation) all moved **days-old
chronological** content that no row permitted.

**What replaced them, and why that specific test.** The old rows returned the same verdict — deny —
for `8847714` and `da62ad2` (both merged) as for the 2026-08-25 pass (reverted). A rule that cannot
separate cases decided oppositely is not governing the decision. Checking what actually differed:
`8847714` and `da62ad2` **left the original `##` heading in place**, suffixed "— condensed, full
detail archived" (still visible in `progress.md` — grep for "condensed, full detail archived"; line
numbers are deliberately omitted, they have gone stale three times in this file already), so every `[NS-N]` citation
still resolved; the reverted pass **broke one** — `[NS-35]`'s citation to Round 4. **That single
DENY case is recorded from session notes, not reproduced from git**, and it is the only DENY among
the four outcomes; the three PERMITs are independently verifiable. If the 2026-08-25 pass was
actually reverted for lack of authorization rather than for the broken citation, this rule is
proven on three PERMITs and no DENY — restate the claim rather than leave it overstated. The discriminator is **citation survival**, not age and not content type.
The amended row reproduces all four historical outcomes, including the revert.

**Why the pointer must carry the original heading text.** This is what keeps the citation resolving
*in place*, and it is not cosmetic. `docs/archive/progress-reference-sections-2026-08-23.md` records
why a chronological pass was rejected on evidence at that time: citations live in
`activeContext.md`, so rewriting them spends headroom in a **second capped file**. Measured
2026-08-27: `activeContext.md` was at **149 lines against a 150 hard-fail** — one line. A pointer
that preserves the heading lets the citation resolve by `grep` with zero new lines pushed into that
file.

**The verbatim guard survives unchanged**, and one guard is added. Verbatim means no condensing, no
summarising, no rewriting; a relocation that rewrites is an eviction in disguise, and loses exactly
the detail the archive exists to keep.

The added guard is **boundedness of the destination**, and it is deliberately two-branched rather
than a blanket "must be capped". Archive files under Archive Structure are already bounded by
construction — one topic or period per file, never appended to — so they need no cap and none was
retrofitted onto them. A *living* destination is the actual hazard: it accretes without limit, and
content that leaves a capped file for an unbounded one has not been archived, it has been hidden.
That defect was live when this amendment was written — `docs/MEMORY-BANK-PARADIGM-REVIEW.md` is
self-described "Living document", had received two relocations, and stood at 693 lines / 56,732
bytes under no cap of any kind.

Frontmatter was considered as a third guard and **rejected**: nothing outside `memory-bank/` reads
those fields, `mb doctor` does not validate them there, and the repo's own compliant precedent
(`docs/archive/progress-reference-sections-2026-08-23.md`) carries none. Requiring it would have
been convention copied into a place that does not consume it.

**What this does NOT fix.** Eviction is symptom relief. At the measured write rate above, the
2026-08-26 relocation bought **days, not weeks** of headroom — no figure is given because every
attempt to state one has decayed before the branch stating it landed — and `docs/archive/` already held
**149,711 bytes** moved out by this same mechanism while `progress.md` still hit its cap. The
binding constraint is write *rate*, not eviction policy — tracked as `[NS-42]`, not solved here.

**Why the reference-sections row is not an age test either.** The trigger there is *misfiling*, not
staleness — content that was never progress in the first place does not become evictable by getting
older. It was added 2026-08-24 after a real relocation had no documented basis under the then-current
age rules.

Run `mb doctor` to surface files that are stale or due for review.

## Archive Structure

Archival uses a flat `docs/archive/` directory. See `docs/archive/README.md` for naming
conventions. Files are named with a date prefix and short topic label so the flat listing
stays scannable. Add subdirectories only when the flat listing grows past ~50 files.

```
docs/archive/
  handoff-YYYY-MM-DD.md        (handoff files)
  snapshot-YYYY-MM-DD.md       (memory snapshots)
  context-YYYY-MM-topic.md     (evicted from activeContext.md)
  progress-YYYY-MM-topic.md    (evicted from progress.md)
```

Never append to an existing archive file — one topic or time period per file.

## What Must Never Appear in Memory Bank Files

Memory Bank files are version-controlled and loaded into AI context on every request. Never store:

- Secrets, API keys, tokens, passwords, or credentials
- PII: names, emails, phone numbers, SSNs, customer identifiers
- Production data samples or database exports
- Full code file dumps (reference file paths instead)
- Internal IP addresses, hostnames, or network topology

## Rule Loading

### Cursor IDE

Create `.cursor/rules/memory-bank.mdc`:

```yaml
---
alwaysApply: true
---

# Memory Bank - Persistent Context

At the start of every conversation (and after any context compaction), silently read ALL files in memory-bank/ to restore context.
Never ask the user to repeat constraints already documented there.

## Files to Read (in order)
1. memory-bank/projectbrief.md - Non-negotiable constraints
2. memory-bank/systemPatterns.md - Patterns to follow
3. memory-bank/techContext.md - Tech stack details
4. memory-bank/activeContext.md - Current focus
5. memory-bank/progress.md - What's done/planned

## Rules
- Never violate constraints in projectbrief.md
- Always follow patterns in systemPatterns.md
- Don't ask for info already in techContext.md
- Update Memory Bank after significant changes
```

### Claude Code

Create `CLAUDE.md` in project root with Memory Bank instructions (see template).

## Worktree Guidance

`memory-bank/` is canonical and lives in the **main worktree** only.

- From a git subworktree, read memory-bank/ from the main worktree root:
  ```bash
  $(git rev-parse --git-common-dir)/../memory-bank/
  ```
- Never update or commit memory-bank/ files from within a subworktree. Update the
  main worktree instead, then pull the changes into your branch if needed.
- `mb commit` detects subworktrees and refuses with a redirect message.
- `.githooks/pre-commit` refuses a plain `git commit` of memory-bank/ from a subworktree too.
  Merging main in is allowed when memory-bank/ matches the merged branch; see
  `docs/HOOKS-GUIDE.md` for what the hook cannot catch.

This keeps a single authoritative copy. Subworktrees are ephemeral execution branches;
the memory-bank is shared state.

## Claude Code vs Cursor: Context Lifecycle

These two tools load memory-bank rules differently — the difference matters for context management.

### Cursor IDE
`.cursor/rules/memory-bank.mdc` with `alwaysApply: true` **re-injects** the memory-bank instruction on every response. Even after context fills, rules are always present.

### Claude Code
`CLAUDE.md` loads **once at session start** as part of the system prompt. It is NOT re-injected after auto-compaction.

Claude Code auto-compacts at the percentage set by `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in settings.json (without an override, ~95%) — silently, with no hook or notification to the agent. **Read the configured value; do not assume one.** This sentence previously hardcoded 50%, which had drifted from the live setting and shipped that way to every adopter. The session continues with a compressed summary; detailed history is lost.

### Implications for Handoff Thresholds

| Tool | Handoff Threshold | Why |
|------|------------------|-----|
| Claude Code | **40%** | Manual compact before auto-compact fires |
| Cursor | **40%** | Same quality curve; rule re-injection does not address it |

**Why both are 40%, and why Cursor's was 80% until 2026-08-28.** The old Cursor figure was justified
as "rules re-inject automatically; compaction less critical." That reasoning is sound but covers only
one of the two costs of a full context:

- **Continuity cost** — will the agent lose its instructions when context is squeezed? Cursor
  genuinely mitigates this by re-injecting `.mdc` rules on every response. This is what 80% was
  reasoning about, and it was correct about it.
- **Quality cost** — output degrades as input length grows, whether or not the rules survive.
  Re-injection does nothing for this, and it is the *load-bearing* reason to keep context small
  (Chroma, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*, 18 models across four
  providers — https://www.trychroma.com/research/context-rot).

The quality curve is a property of the model and the input length, not of the IDE. So it does not
move when rules re-inject, and there is no basis for permitting a longer context in Cursor than in
Claude Code. 80% also sat *above* the value `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is set to, i.e. beyond
the point this project already treats as unacceptable in the other IDE.

**Do not re-derive a Cursor-specific number from rule-persistence behaviour.** That is the reasoning
that produced 80%. If this threshold changes, it should change for both tools together, because the
constraint that binds is shared.

### Post-Compaction Recovery (Claude Code)
If compaction fires before handoff, instruct the agent to re-read all `memory-bank/` files:
```
Please re-read all memory-bank/ files to restore full context
```
The `templates/CLAUDE.md` includes a compaction recovery instruction block that handles this automatically when observed.

## Handoff Protocol

When context fills up (user reports 40% in either tool), create a handoff:

### Trigger
- User types "Handoff"
- User reports context >= 40% (both Claude Code and Cursor)
  - Claude Code auto-compacts at the configured threshold; 40% fires before that
  - Cursor exposes no auto-compact threshold this project can configure, so 40% is the only
    intervention point rather than the first of two. (Whether Cursor performs any internal
    summarisation of its own is **not observable from here and has not been verified** — do not
    read this as "Cursor never compacts".)

### Scope is deliberately narrow

`memory-bank/` — especially `activeContext.md`'s Next Steps — is the durable source of truth for
priority and rationale, and is supposed to be current *throughout* the session, not only at the end.
`handoff.md` exists ONLY to carry genuinely ephemeral in-flight state that a memory-bank update
would not naturally hold: where an edit was interrupted, uncommitted diff state, what was about to
be run next.

**Do not use `handoff.md` to summarise accomplishments, decisions, priorities, or task ordering.**
That duplicates the memory bank, and the duplicate is written under the worst possible conditions
for careful synthesis — an imminent compaction or context limit. A duplicate written there will
drift from the original, and the next session is instructed to trust the original.

### Agent Actions
1. **STOP** all work immediately
2. **VERIFY** `activeContext.md` and `progress.md` are actually current. If stale, update them
   FIRST — a rich `handoff.md` cannot compensate for a stale memory bank, because the next session
   is told to treat the memory bank as authoritative and this file as a supplement
3. **CREATE** `handoff.md` in project root, scoped ONLY to:
   - Exact in-flight state — file and line being edited, uncommitted diffs, what was about to run
   - Any running process or service left in a non-default state
   - Any command needed to resume
   - The branch, and whether a worktree is in use
   - An explicit pointer: "See `memory-bank/activeContext.md`'s Next Steps for priority and
     rationale; this file covers only what was not captured there yet."
4. **RESPOND** only: "Handoff ready at `handoff.md`. Start a new conversation." — with the title for
   the next session, the branch, and the worktree state
5. **STOP** — do not continue

### Next Session
1. Read ALL files in `memory-bank/` **FIRST**. This is the authoritative source for priority,
   rationale, and what has already been tried. **Do not treat `handoff.md` as authoritative for any
   of those.**
2. Read `handoff.md` **SECOND**, treating it only as the narrow ephemeral-state supplement above —
   never as a summary to synthesise task priority from
3. Reconcile: does the handoff's in-flight state match what `activeContext.md`'s Next Steps implies
   should be happening? **If they conflict, surface the conflict — do not silently pick one**
4. Merge the handoff into the memory bank, then **delete `handoff.md`**
5. Confirm where to resume if mid-task

**Why the ordering matters, and why it changed.** An earlier version of this standard said to read
`handoff.md` first and listed "summary of accomplishments" among its contents. Both were superseded:
reading the handoff first inverts the authority order, making a hurriedly-written file the primary
source over the continuously-maintained one. Deleting the handoff after merging is also not
housekeeping — a handoff left in place is a spent bypass of the PreCompact freshness gate, which is
why that gate now requires the file to be dated today.

## Task Decomposition

For multi-session work, create `plan.md`:

```markdown
# Plan: [Feature Name]

## Scope
Brief description of what we're building.

## Chunks (each fits one session)
- [ ] Chunk 1: Backend API endpoints
- [ ] Chunk 2: Database schema + migrations
- [ ] Chunk 3: Frontend components
- [ ] Chunk 4: Integration + testing

## Handoff Points
After each chunk, update activeContext.md and commit.

## Dependencies
- Chunk 2 depends on Chunk 1
- Chunks 3-4 can start after Chunk 2
```

### Scope Heuristics

| Task Type | Estimated Sessions | Planning |
|-----------|-------------------|----------|
| Single file change | < 1 | No planning needed |
| Feature (1 component) | 1 | May need handoff |
| Feature (multi-file) | 1-2 | Consider plan.md |
| New service/module | 2-3 | Definitely plan.md |
| Large refactor | 3+ | Break into phases |

## Quick Commands

Teach AI to recognize these shortcuts:

| Command | Action |
|---------|--------|
| `update memory bank` | Update all relevant Memory Bank files |
| `mb status` | Show file sizes, timestamps, health check |
| `mb clean` | Trim activeContext.md to essentials and move old history to `docs/archive/` |
| `mb commit` | Stage and commit Memory Bank changes |

## Auto-Update Behavior

Agent should proactively update Memory Bank:

- After completing feature/fix → progress.md
- After adding dependencies → techContext.md
- After establishing patterns → systemPatterns.md
- At session end ("done", "wrap up") → offer to update

## Tag-Based Retrieval

Each memory-bank file carries YAML frontmatter with hierarchical tags:

```yaml
tags:
  - auth/session
  - infra/postgres
```

Use `domain/concept` format. Flat tags (`auth`, `session`) are not used — they accumulate
synonym drift and require maintenance discipline that rarely survives project scale.

`mb query <keyword>` searches tags and section headers across all memory-bank files.
Partial hierarchical matches work: `mb query auth` matches `auth/session`, `auth/oauth`.

**Upgrade path:** Tags are embedding labels. To add semantic retrieval later, wire the
`tags:` field to a vector pipeline — no structural changes to the files required.

## Memory Compaction

Compaction is distinct from eviction. Eviction removes stale entries. Compaction rewrites,
summarizes, deduplicates, and resolves contradictions across all memory-bank files.

**When to compact:** when `mb doctor` shows ≥ 2 files stale AND `memory-bank/` total size
exceeds 60 KB. Run `mb clean` to get a structured AI prompt for the operation.

**What compaction does (AI-driven):**
1. Reads all files in authority order
2. Identifies: duplicate decisions, contradictory claims, orphaned sections, entries
   already captured elsewhere
3. Rewrites each file to its canonical minimal form
4. Reports what was removed and why

Compaction requires human review of the AI's output before committing. It is never
fully automatic — the AI proposes, the human approves.

## Integration with AGENTS.md

If your project uses AGENTS.md for session history:

- **Memory Bank**: Structured, curated knowledge (organized by topic)
- **AGENTS.md**: Chronological session log (detailed history)
- **handoff.md**: Temporary transition document (delete after merging)

## Success Indicators

Memory Bank is working when:
- ✅ AI never asks for your tech stack
- ✅ AI follows established patterns without prompting
- ✅ New sessions start immediately productive
- ✅ Decisions persist across sessions
- ✅ Code consistency improves
- ✅ Less time explaining, more time building

## Troubleshooting

### AI Not Loading Memory Bank
1. Check rule file exists (`.cursor/rules/memory-bank.mdc` or `CLAUDE.md`)
2. Verify `alwaysApply: true` is set (Cursor)
3. Restart IDE
4. Explicitly reference: `@memory-bank/projectbrief.md`

### Memory Bank Getting Stale
1. Review `activeContext.md` weekly
2. Archive old decisions to `docs/archive/`
3. Update `progress.md` after each milestone
4. Clean up outdated information

### Memory Bank Too Large
1. Move detailed session logs to `docs/archive/`
2. Remove implementation details (keep decisions only)
3. Consolidate related patterns
4. Archive historical context to `docs/archive/`
