CREATE TABLE IF NOT EXISTS ultron_claim_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  step_id UUID NOT NULL,
  claim_text TEXT NOT NULL,
  assessment_status TEXT NOT NULL CHECK (assessment_status IN ('evidence_candidates_found','insufficient_evidence')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','corrected')),
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified','human_reviewed')),
  method TEXT NOT NULL,
  assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_note TEXT NOT NULL DEFAULT '',
  correction TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(owner_id, step_id)
);
CREATE INDEX IF NOT EXISTS ultron_claim_reviews_owner_status
  ON ultron_claim_reviews(owner_id, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS ultron_claim_reviews_run
  ON ultron_claim_reviews(owner_id, run_id);