# ULTRON Phase 2 — Multi-Agent Intelligence & Delegation
Status: bounded specialist execution activated in v181; v184 hardened transient HTTP retry classification, v185 exposed the durable specialist ledger, v187 added mission dependency graphs, v190 added bounded specialist revision history and independent re-verification, v194 hardened numeric contradiction detection using labeled evaluation, and v196 added an independent-origin citation sufficiency gate to claim verification. Full Phase 1 acceptance remains open until the physical iPhone workflow checklist and remaining replay/learning evaluations are completed.

## Mission
Turn the current single-runner workflow into a coordinated team of bounded specialist agents. ULTRON remains the mission owner: it decomposes work, assigns specialists, shares only the context each task needs, reconciles results, and verifies the final outcome.

## Current baseline (v200)
- One durable mission queue and scheduler-driven runner; seven operation types remain supported: research_search, verify_url, retrieve_source, assess_claim, save_learning, create_task, skill_apply.
- Independent ready steps now execute concurrently with a hard ceiling of three workers. Dependency checks still gate downstream steps; atomic pending-to-running claims prevent two workers from claiming the same step.
- Transient HTTP 408/425/429/5xx status-only errors are classified for bounded retries; permanent 4xx failures are not retried. v184 added regression assertions for both paths.
- The mission inspector displays durable execution/verifier task roles, phases, statuses, attempts, verification decisions, challenge checks, errors and bounded outputs (v185). v187 added dependency-aware graph views to plan previews and live mission inspection. v190 adds an append-only revision ledger with original/revised input and output, verifier challenges, outcomes and errors.
- Run and specialist leases are ten minutes. Recovery requeues a running step as soon as an expired execution/verifier lease has been reset to pending, even if the step's own ten-minute age threshold has not elapsed. Active tasks remain untouched, and stale running steps still recover. Cancellation now blocks new specialist work, checks mission state before and after execution, conditionally commits verifier/execution task states, and gates task, knowledge, skill-application and claim-review writes on the mission still being running. Late results cannot reopen skipped tasks or overwrite cancelled state.
- Task, knowledge and skill-application writes use per-step idempotency identities and read-back checks. Skill applications have a unique `agent_step_id` (migration 017).
- Migration 018 adds `ultron_specialist_tasks`: each mission step has a durable execution task and a separate verifier task with role, capability allowlist, input-context snapshot, status, attempts, lease, output, verification and error fields.
- Researcher, analyst and executor roles are routed by operation type. A separate deterministic verifier module independently checks source/result shape and reads persisted task, knowledge, skill-application and claim-review records back before accepting the operation.
- These are bounded deterministic specialist workers, not separate paid LLM instances. No model/provider generation or paid credits are used by the parallel worker path. Factual accuracy remains distinct from operation verification and still requires human review where appropriate.
- Owner-approved lessons are loaded before matching step execution; prior 403 retrieval failures can block an unchanged retry. Candidate lessons remain reviewable and are not automatically promoted.
- Natural-language planning remains deterministic and free of model calls. The compound “research and compare” regression passes.
- Claim analysis checks support/contradiction candidates, polarity, numbers, source grouping, freshness and provenance. The v194 labeled evaluation exposed and fixed a numeric-conflict blind spot where a shared year could mask a mismatched value; the suite covers polarity, negation, numeric agreement/conflict, direction, hedging, relevance, entity mismatch and distinct-origin grouping. These remain heuristic screens, not semantic entailment or proof of truth; human review remains mandatory. A conservative standalone arithmetic evaluator now parses explicit numeric equalities with a safe recursive-descent parser (addition, subtraction, multiplication, division, parentheses and percentage operands); it flags mismatched results but leaves prose, unit-bearing expressions and division by zero unevaluated. It is a calculation primitive with labeled regression fixtures, not yet wired into claim assessments because current assessment records do not preserve a structured calculation-evidence contract.
- Daily self-tests cover free-service availability, planning, dependency gating, coordinator graph invariants, lease-boundary recovery, cancellation guards, bounded specialist revision eligibility and budget, status-only transient retry versus permanent-failure handling, parallel worker overlap, seeded verifier rejection, outcome criteria, contradiction signals, source grouping and redirect safety. The v196 run passed all sixteen checks, including eight labeled claim-evidence fixtures, a distinct-origin positive control and a verifier test rejecting duplicate-origin citations. The v198 suite adds eight explicit arithmetic fixtures covering correct/incorrect sums, multiplication, percentages, decimal rounding, divide-by-zero, ambiguous prose and incompatible units.
- Live integration test: three interrupted independent research specialists were recovered concurrently; all three received separate verifier passes, a previously completed branch was not rerun, and a dependent synthesis step remained blocked until all prerequisites completed. A seeded empty-result specialist was correctly rejected rather than silently marked successful. A separate lease-boundary fault injection exposed and fixed the case where an expired specialist lease preceded the step's stale-age threshold; the regression is now in the live self-test.
- Fault injection: a failed third step retried successfully while the first two completed steps stayed at one attempt. An expired run/step/specialist lease was recovered; only the interrupted third step reran. Live cancellation integration called the owner-facing cancel endpoint with three running steps and six active specialist tasks; all nine work records became skipped, the cancelled run was not eligible for another runner pass, and temporary fixtures were deleted. v200 additionally gates persistent writes and late task commits against cancelled mission state.
- Duplicate-side-effect replay test: after creating one task and one knowledge record, both steps were fault-injected into expired-running state and recovered. Each replay read the original record (`idempotentReplay=true`); database read-back confirmed exactly one record per step. Temporary test-owner records were deleted after verification. Skill-application writes have the same unique step identity and read-back logic but still need their own replay fixture.
- Physical iPhone Safari acceptance remains unverified. Broader real-world tests of claim accuracy and adaptive-learning improvement also remain open; v181 does not claim full Phase 1 acceptance.

## Target specialist roles
1. **Planner / Coordinator** — converts an objective into a bounded task graph, sets dependencies, budgets, deadlines and completion criteria. Does not mark its own work verified.
2. **Researcher** — discovers public sources, captures source excerpts and provenance, and labels uncertainty. Read-only by default.
3. **Analyst** — compares captured evidence, performs calculations and synthesizes findings with traceable source references.
4. **Verifier / Critic** — independently checks the plan, evidence, calculations, outputs and acceptance criteria. Must not simply repeat the producer's conclusion.
5. **Executor** — performs explicitly permitted app operations and returns persisted result identifiers plus read-back checks. External side effects remain approval-gated.

## Coordination model
- A mission is a directed acyclic task graph, not merely an ordered list.
- Each delegated task records parent mission, specialist role, input context snapshot, dependencies, allowed tools, limits, status, attempts, lease, output, evidence and verifier decision.
- Shared context is versioned and provenance-aware. Agents receive the minimum relevant context; they do not silently rewrite shared memory.
- Independent tasks may run concurrently under a bounded concurrency limit. Dependent tasks wait for successful prerequisites.
- The coordinator reconciles outputs, resolves conflicts explicitly, and produces a final report linking every material claim to evidence and every action to a persisted result.
- Retries are idempotent, bounded, and informed by prior failures. A failed task does not silently become a success.
- Verifier findings can reject, request revision, or pass with limitations. The producer cannot approve its own output.

## Safety and operating boundaries
- Free-first. No paid model/provider calls or credit-consuming fallback without explicit user approval.
- Read-only research by default. Sending messages, changing accounts, purchases, publishing, deleting, or other consequential actions require explicit authorization and confirmation at the point of action.
- Per-role tool allowlists, URL/network safety checks, owner-scoped database access, strict time/token/request budgets, and audit logs.
- Treat retrieved pages, files and delegated-agent outputs as untrusted data, never as instructions to override policy or user intent.
- Preserve all existing runs, records, memories, secrets, provider settings, routes and project visibility.

## Phase 2 acceptance criteria
- A mission is decomposed into a validated dependency graph with explicit measurable acceptance criteria.
- Researcher, analyst and executor tasks have separate durable execution records; every execution task has a separate verifier record with attributable output.
- Independent tasks execute concurrently within the hard limit of three; dependent tasks wait for completed prerequisites.
- Context snapshots, capability allowlists, attempts, leases, output, verifier findings and errors are persisted in the specialist audit ledger.
- The deterministic verifier rejects seeded empty/malformed research output and independently reads back persisted task, knowledge, skill-application and claim-review records. Claim-review verification now checks independent origin-group sufficiency separately from raw source count; it still does not establish semantic entailment or factual truth. Structured extraction of calculations from source passages and end-to-end claim-assessment integration remain future work; the standalone arithmetic evaluator is implemented and regression-tested in v198.
- Recovery resumes expired leases; the injected retry test proved completed steps were not repeated, and cancellation stopped queued execution/verifier tasks.
- The mission inspector exposes the specialist audit ledger, dependency graph and revision history with original-versus-revised evidence comparison. The current revision loop is intentionally narrow: one deterministic query revision for a rejected research_search step only, followed by a fresh independent verifier pass. It does not revise write operations or call paid/model-backed agents. General semantic revision strategies, live progress visualization and broader specialist revision controls remain future work.
- Physical iPhone end-to-end acceptance remains required. The current worker path uses deterministic free specialist logic, not paid LLM agents.

## Remaining Phase 1 closure requirements
- Natural-language planning regression passes; broader objective coverage still needs an evaluation set.
- Claim analysis now checks support/contradiction signals, source grouping, freshness and provenance. It remains heuristic; test against a larger labeled claim set and retain human review.
- Success/failure lesson promotion is owner-approved, but measurable improvement across repeated tasks still needs a controlled evaluation.
- Server-side retry, interrupted-lease recovery, dependency gating and cancellation passed deterministic fault injection. Broader duplicate-side-effect replay tests across every write type remain required.
- General outcome verification now has seeded met/unmet/human-review tests; add more real workflows for research, persistence and permitted actions.
- Complete owner-facing iPhone Safari workflows have not been physically tested. Do not mark Phase 1 fully accepted until the checklist in `lib/iphone-workflow-qa.md` is completed.
- Limited deterministic parallel specialist execution is enabled in v181. Full Phase 1 completion and any expansion to model-backed specialist agents remain gated on the remaining evidence above.

## Next implementation sequence
1. Expand labeled evaluation fixtures to cover citation sufficiency, source provenance, arithmetic extraction and edge cases across diverse claims; the initial v191 set covers eight claim-signal fixtures plus an independent-origin positive control.
2. Test idempotent replay for each persisted side-effect type and measure approved-learning usefulness across repeated tasks.
3. Extend the graph UI with live progress transitions, evidence links, verifier challenge navigation and recovery status.
4. Expand revision loops only after labeled evaluations: add safe operation-specific strategies, producer correction, independent re-verification, strict budgets and preserved versions. Current v190 research-only bounded cycle is the first safe implementation.
5. Complete physical iPhone Safari acceptance and record device/browser evidence.
6. Only after those gates, evaluate separate model-backed specialist agents, with free-mode routing and explicit approval before any paid provider use.

This document records the live bounded-specialist implementation and explicitly distinguishes it from fully autonomous, model-backed specialist agents.