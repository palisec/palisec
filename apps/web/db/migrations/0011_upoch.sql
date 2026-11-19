-- Phase 6.5: an agent's Upoch workflow (read-only integration). Optional; used by the schema 1.2
-- upoch_recovery rule and the console's Upoch status. The workflow is read from Upoch's public contract.
ALTER TABLE agents ADD COLUMN upoch_workflow_id text CHECK (upoch_workflow_id ~ '^[1-9][0-9]{0,18}$');
