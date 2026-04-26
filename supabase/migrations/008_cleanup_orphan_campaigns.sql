-- One-shot cleanup: delete draft campaigns with no steps (orphans from pre-16a.1 flow)
DELETE FROM campaigns
WHERE status = 'draft'
  AND NOT EXISTS (
    SELECT 1 FROM campaign_steps WHERE campaign_steps.campaign_id = campaigns.id
  );
