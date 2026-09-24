ALTER TABLE ai_decisions DROP CONSTRAINT IF EXISTS ai_decisions_confidence_check;
ALTER TABLE ai_decisions ALTER COLUMN confidence TYPE NUMERIC(6,5)
  USING CASE WHEN confidence > 1 THEN (confidence / 100)::NUMERIC(6,5) ELSE confidence::NUMERIC(6,5) END;
ALTER TABLE ai_decisions ADD CONSTRAINT ai_decisions_confidence_check CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);
