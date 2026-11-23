-- Holder mandates: a passed loosening waits as a pending change; when that change takes effect, the proposal
-- is marked applied too (it stayed 'pending' before). One trigger, so every path that applies a pending
-- change (lazy apply, health check, console) keeps the two in step.
CREATE OR REPLACE FUNCTION ps_mandate_pending_applied() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'applied' AND OLD.state IS DISTINCT FROM 'applied' THEN
    UPDATE mandate_proposals SET applied = 'applied' WHERE pending_change_id = NEW.id AND applied = 'pending';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER pending_changes_mandate_applied AFTER UPDATE OF state ON pending_changes
  FOR EACH ROW EXECUTE FUNCTION ps_mandate_pending_applied();

UPDATE mandate_proposals p SET applied = 'applied'
FROM pending_changes c WHERE p.pending_change_id = c.id AND p.applied = 'pending' AND c.state = 'applied';
