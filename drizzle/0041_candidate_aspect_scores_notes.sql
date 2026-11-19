-- Aspect-score cache: store the LLM evaluator's reasoning ("notes") alongside
-- the score, so the justification agent has per-aspect evidence even when every
-- score is a cache hit. Nullable — old rows simply have no notes until rescored.
ALTER TABLE "candidate_aspect_scores" ADD COLUMN IF NOT EXISTS "notes" text;
