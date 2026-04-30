-- migration 022: user's own company industry and size (distinct from ICP target audience fields)
ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS user_industry     text,
  ADD COLUMN IF NOT EXISTS user_company_size text;
