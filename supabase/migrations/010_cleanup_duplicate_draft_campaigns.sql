DELETE FROM campaigns
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY workspace_id, name ORDER BY created_at) AS rn
    FROM campaigns
    WHERE status = 'draft'
  ) t
  WHERE rn > 1
);
