-- Sprint 16a.1: Multi-select ICP company sizes
ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS icp_company_sizes text[];

UPDATE workspace_profiles
  SET icp_company_sizes = ARRAY[icp_company_size]
  WHERE icp_company_size IS NOT NULL
    AND icp_company_size != ''
    AND icp_company_sizes IS NULL;
