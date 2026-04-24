# Sentra

B2B SDR platform — from cold list to booked meetings, on autopilot.

## Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: Supabase (Auth, Postgres, Storage, RLS)
- **AI**: Anthropic Claude (sequences, ICP parsing, inbox drafts, morning briefs)
- **Email**: Resend (transactional + broadcast)
- **Hosting**: Vercel (`sdr-platform-sigma.vercel.app`)

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in required vars
npm run dev
```

## Required environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
RESEND_API_KEY
NEXT_PUBLIC_APP_URL
```

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run lint     # ESLint
```
