ALTER TABLE campaign_steps
  DROP CONSTRAINT IF EXISTS campaign_steps_campaign_id_fkey;

ALTER TABLE campaign_steps
  ADD CONSTRAINT campaign_steps_campaign_id_fkey
  FOREIGN KEY (campaign_id)
  REFERENCES campaigns(id)
  ON DELETE CASCADE;
