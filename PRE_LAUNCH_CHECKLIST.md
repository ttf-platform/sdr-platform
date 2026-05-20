# Pre-launch checklist

## Supabase Authentication
- [ ] **Disable auto_confirm** in Authentication → Settings (currently ON for dev/beta — enables immediate dashboard access without email verification)
- [ ] Verify Email templates configured: Confirmation, **Reset password**, Magic link
  - Reset password template must redirect to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`
- [ ] Set Site URL to production domain in Supabase Auth settings (currently: sdr-platform-sigma.vercel.app — update after brand/domain confirmed)

## Sentra Admin Access
- [ ] Add founder email(s) to `SENTRA_ADMIN_EMAILS` env var (Vercel + .env.local) to unlock `/admin` backend and `/dashboard/admin` panel
  - Format: comma-separated, e.g. `max@sentra.app,support@sentra.app`

## Branding / Domain
- [ ] Confirm production domain (sentra.app deferred — verify brand name before DNS setup)
- [ ] Update Stripe public business name to confirmed brand ("Sentra" currently set)
- [ ] Update `NEXT_PUBLIC_APP_URL` env var to production domain

## Billing
- [ ] Verify Stripe webhook is pointing to production domain (not staging)
- [ ] Test end-to-end: signup → trial → checkout → Stripe webhook → plan_tier update → feature gating

## Security
- [ ] Run `/security-review` on main branch before first real-user launch
- [ ] Rotate any dev/test API keys that were used in staging
