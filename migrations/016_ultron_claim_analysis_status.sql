-- Allow the stronger claim-analysis outcomes (conflicting and contradicted evidence) in claim reviews.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'ultron_claim_reviews'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%assessment_status%'
  LOOP
    EXECUTE format('ALTER TABLE ultron_claim_reviews DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE ultron_claim_reviews
  ADD CONSTRAINT ultron_claim_reviews_assessment_status_check
  CHECK (assessment_status IN ('evidence_candidates_found','insufficient_evidence','conflicting_evidence','contradicted_candidate'));