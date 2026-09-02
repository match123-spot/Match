-- Claude makes the final call among the top formula-ranked candidates,
-- not just the formula's #1 automatically. Persisted on the match itself
-- so the reasoning is part of the permanent record, not just a preview
-- artifact that disappears after the request is made.
ALTER TABLE matches ADD COLUMN ai_selection_reasoning TEXT;
ALTER TABLE matches ADD COLUMN ai_selection_rank INTEGER; -- 1-based formula rank of the candidate Claude actually picked (1 = agreed with the formula's top pick)
