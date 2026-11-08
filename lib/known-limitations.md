# ULTRON — Known limitations and remediation register

Last audited: 2026-11-08. Live release at audit: v304; browser worker hardening is being prepared for the next release.

This register separates verified behavior from unverified capability. A passing backend self-test does not prove browser GPU inference, microphone/camera permissions, or factual accuracy.

## Verified operational baseline
- Existing project only: `ultron-ptje`; private/personal visibility preserved.
- Latest completed live backend self-test: 46/46 checks passed; no deterministic or external-service failures.
- NVIDIA credential is configured. `GET /v1/models` succeeded and returned 84 catalog entries. Catalog visibility does not establish inference billing or model availability.
- Cloudflare voice credentials are configured. The voice capability endpoint reports STT and TTS available.
- Live owner data audit: 45 mission runs (40 completed, 4 failed, 1 cancelled); no expired running mission lease was found.
- The failed mission records currently visible are historical regression/fault-injection runs (403 source retrieval, deliberately blocked repeated 403, and empty-source verifier rejection), not evidence of a current stuck running mission.
- Current backend test does not run the local browser model or physically exercise the owner's iPhone.

## Limitations, current impact, and remediation

### 1. Local language model is starter-scale
- Current model: SmolLM2-360M-Instruct, quantized for WebGPU.
- Impact: insufficient capacity for advanced research, deep reasoning, long context, complex planning, and robust tool use.
- Remediation: benchmark candidate open-weight models against device memory, latency, and battery; upgrade only after device-specific testing. Keep model downloads explicit and do not silently switch to a remote provider.
- Status: architecture and model-selection work remains open.

### 2. Actual on-device inference has not been verified
- The model loads only after the owner explicitly taps Load local model. It needs WebGPU, a supported worker, HTTPS, and an initial internet download.
- Prompt and generated output are intended to stay in the browser; initial runtime/model files are downloaded from public distribution hosts. Full offline behavior has not been verified.
- Impact: backend tests cannot establish that the owner's iPhone can load the model or complete inference.
- Remediation: run the physical iPhone load, generation, unload/reload, low-memory, background/return, and offline tests; record actual device/browser/model/latency.
- Status: owner-device acceptance required.

### 3. Three local specialist sessions are not independent models
- Researcher, analyst, and verifier are separate sequential prompts to the same small model and share one inference worker.
- Backend mission specialists are bounded deterministic workers, not independently trained autonomous LLMs. Remote NVIDIA specialist inference is disabled by default.
- Impact: role separation helps structure review but does not provide independent model diversity or eliminate correlated errors.
- Remediation: develop independently evaluated specialist engines/models, with distinct evidence access and a verifier that can reject the producer. Do not enable metered inference without explicit approval.

### 4. Local neural benchmark is narrow and unrun on the owner's device
- The browser benchmark has five fixed cases and 15 role-level checks. Its keyword/rubric matching is approximate and can award false positives.
- Results and lessons are stored in that browser's localStorage, not in the server database.
- Impact: no valid device benchmark score exists yet; the current suite cannot prove general intelligence.
- Remediation: expand to held-out math, multi-hop logic, long-context, source attribution, contradiction, calibration, abstention, adversarial prompts, and repeatability tests. Use exact/structured scoring where possible, human-reviewed semantic grading where needed, and report per-case/per-role results with confidence intervals.

### 5. Memory has multiple scopes, not one unified learning system
- Owner memories and knowledge are stored in the project database; the live database currently contains 1 explicit memory and 65 knowledge records.
- Local model chat history is only the last eight messages in browser memory and is cleared when the model is unloaded or the page session ends.
- Local benchmark lessons are browser-local prompt guidance; they do not update model weights or automatically become server memories.
- Impact: context continuity differs between server chat, persistent memory, and local inference.
- Remediation: implement a consented, owner-scoped memory bridge with provenance, expiry, conflict handling, retrieval tests, and user review. Keep local-only memory separate unless the owner explicitly syncs it.

### 6. Learning is measured and approval-gated, not self-training
- ULTRON can record outcomes, recommend lessons, and apply explicitly approved lessons to matching operations.
- It does not currently retrain its own neural model weights. Small samples are insufficient for reliable conclusions; lessons and strategy selection require human approval.
- Remediation: collect larger controlled evaluations, test for regressions and task-mix confounds, and only then propose reviewed model/strategy updates. Never silently promote a lesson.

### 7. Research and claim verification are still heuristic
- Source independence, claim relevance, contradiction, freshness, and context are evaluated with deterministic/heuristic checks.
- These checks are not proof of semantic entailment, editorial independence, or factual truth. Human review remains necessary for consequential claims.
- The explicit arithmetic parser is tested but is not yet wired into claim assessments because the assessment pipeline lacks a structured calculation-evidence contract.
- Remediation: add structured claim/evidence/calculation records, adversarial semantic evaluation, publisher-origin review, and explicit uncertainty reporting.

### 8. Mobile physical acceptance is incomplete
- Owner has confirmed Home Screen installation and launch.
- Remaining physical iPhone checks include Safari session persistence, safe areas, keyboard behavior, background/return, microphone and camera permission flows, VoiceOver, larger text, and slow-network recovery.
- Remediation: complete and record the physical-device acceptance checklist. Automated server/Chromium tests are not a substitute.

### 9. Voice works at the capability/configuration level; device behavior still needs testing
- The live voice endpoint reports Cloudflare speech-to-text and text-to-speech as available.
- Actual microphone permission, recognition quality, wake-word behavior, interruption handling, and spoken playback must still be tested on the target iPhone/browser.
- Remediation: complete physical-device voice QA and verify behavior when permission is denied or connectivity drops.

### 10. Vision is consent-based single-frame analysis, not continuous surveillance
- Camera preview is local to the device. A frame is uploaded only after a separate confirmation; the current backend uses NVIDIA vision.
- Impact: there is no continuous remote video analysis, recording, identity recognition, or autonomous threat guarantee.
- Remediation: any future live-stream feature needs explicit scope, consent, privacy controls, retention rules, and separate safety/security review. Do not enable background capture.

### 11. Sensor, aircraft, and drone integration is import-only
- Sensor Desk accepts owner-authorized structured exports. The live endpoint reports device connections not configured.
- There is no live drone/camera/aircraft telemetry connection and no aircraft or drone control.
- Remediation: add read-only vendor integrations only after protocol, credentials, ownership, safety, and legal authority are established. Keep flight/control commands out of scope absent a separately approved safety case.

### 12. Mission queue latency is constrained by the current hosting plan
- The agent runner cron is hourly. Hatchable rejected a five-minute schedule because the current Free plan enforces a one-hour minimum.
- Remediation: keep hourly polling on the current plan, or obtain explicit owner approval before any plan upgrade. Do not bypass platform limits.
- A terminal-state compare-and-set fence is deployed in v303; browser worker crash handling is being hardened in v305.

### 13. Public access is intentionally restricted
- Project visibility is personal/private. Visitors who are not the owner or collaborators see the Hatchable sign-in page.
- Remediation: only change to public if the owner explicitly requests public access and understands that this changes exposure.

### 14. Provider catalog is not the same as verified inference
- NVIDIA key and catalog are verified; 84 models are listed.
- No NVIDIA generation test was performed in this audit because catalog access does not establish free usage or remaining trial credits. Paid or billing-unknown inference remains disabled unless explicitly approved.
- TAVILY and GROQ credentials were not present in the configuration audit; neither is required for the currently verified Cloudflare voice path. NVIDIA/Cloudflare/OpenAI key values are never recorded in this report.
- Remediation: perform one small inference test only after the owner confirms the chosen model's billing terms or explicitly authorizes the test.

## Recently applied reliability fixes
- v303: terminal mission responses are now returned only after the corresponding conditional database commit succeeds; stale workers reconcile against authoritative state rather than claiming an uncommitted result.
- v304: browser local-model worker failures reject pending inference promises and reset worker state so the owner can retry instead of waiting indefinitely.
- The worker-failure handler is also being updated to terminate the failed worker and release its device resources.

## Acceptance policy
A limitation is not marked fixed merely because code was deployed or a deterministic test passed. It is closed only after its actual execution path is exercised and evidence is recorded.