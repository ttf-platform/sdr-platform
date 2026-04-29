-- Sprint 16c.5: booking link option on initial email drafts
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS include_booking_link_initial boolean NOT NULL DEFAULT false;
