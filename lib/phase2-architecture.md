# ULTRON Phase 2 — Multi-Agent Intelligence & Delegation
Status: architecture preparation only. Phase 2 execution remains gated on Phase 1 acceptance.

## Mission
Turn the current single-runner workflow into a coordinated team of bounded specialist agents. ULTRON remains the mission owner: it decomposes work, assigns specialists, shares only the context each task needs, reconciles results, and verifies the final outcome.

## Current baseline (v160)
- One durable mission queue and one scheduler-driven runner.
- Seven linear step types: research_search, verify_url, retrieve_source, assess_claim, save_learning, create_task, skill_apply.
- Step dependencies are earlier-position references; the runner processes up to three pending steps per pass.
- Owner-approved lessons are loaded before matching step execution.
- Results distinguish operation verification from factual verification.
- No persistent specialist-agent registry, role-specific capability policy, parent/child delegation records, or independent verifier role exists yet.

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
- A mission can be decomposed into a validated DAG with explicit measurable acceptance criteria.
- At least three specialist roles can receive separate tasks and return structured, attributable outputs.
- Independent tasks execute concurrently within configured limits; dependent tasks respect prerequisite states.
- Context snapshots, provenance, tool permissions, costs/usage and retries are visible in the audit trail.
- A separate verifier detects seeded test defects (unsupported claim, missing citation, incorrect calculation, unmet acceptance criterion) and blocks final completion.
- Recovery resumes expired leases without duplicate side effects; cancellation stops queued work safely.
- User interface shows the coordinator, specialists, task graph, progress, evidence, blockers and final verification.
- All Phase 2 workflows pass desktop and iPhone end-to-end tests; no paid calls occur in free mode.

## Phase 1 exit gate (must be met before Phase 2 is activated)
- Natural-language objectives reliably produce plans without requiring the owner to manually specify every low-level step.
- Independent claim verification goes beyond term overlap and tests support, contradiction, source independence, freshness and provenance, while retaining human review where needed.
- Success and failure learning is evaluated for usefulness and avoids turning one-off events into broad rules.
- Interrupted mission recovery, leases, retries, cancellation and idempotency pass deterministic fault-injection tests.
- General outcome verification is demonstrated across research, persistence and permitted actions.
- Complete owner-facing iPhone workflows are tested end to end.
- Phase 1 completion is recorded only after evidence for every gate is available.

## First implementation sequence after the gate
1. Add role and capability registry with conservative defaults.
2. Add parent/child delegation and task-graph persistence with migrations.
3. Add coordinator dispatch, bounded parallel worker claims, lease recovery and idempotency keys.
4. Add typed context snapshots and structured specialist result contracts.
5. Add independent verifier and revision loop.
6. Add mission-graph UI, audit views and fault-injection / mobile acceptance tests.

This document is a design baseline, not a claim that multi-agent delegation is already implemented.