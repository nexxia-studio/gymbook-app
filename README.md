# GymBook

> Multi-tenant SaaS platform for fitness studio booking & management.

Built with React · Expo · Supabase · Mollie · Vercel

---

## Stack

| Layer | Technology |
|---|---|
| Mobile app (members) | Expo (React Native) — iOS + Android + PWA |
| Dashboard (gym admins) | React + Vite + Tailwind |
| Admin dashboard (Nexxia) | React + Vite + Tailwind |
| Database | Supabase (PostgreSQL + RLS + Vault) |
| Auth | Supabase Auth |
| Payments | Mollie Connect OAuth |
| Hosting | Vercel |
| Emails | Resend |
| Analytics | PostHog (EU region) |
| Monitoring | Sentry |

## Structure

\`\`\`
apps/
├── dashboard/   → Gym admin dashboard
├── admin/       → Nexxia super admin
└── mobile/      → Member app (Expo)

packages/
├── ui/          → Shared components
├── i18n/        → Translations (FR/NL/EN/DE)
└── types/       → Shared TypeScript types

supabase/
├── migrations/  → SQL schema versions
├── functions/   → Edge Functions (Deno)
└── seed/        → Initial data
\`\`\`

## Branches

| Branch | Environment | URL |
|---|---|---|
| `main` | Production | app.move95.be |
| `develop` | Staging | staging.app.move95.be |
| `feature/*` | Preview | Auto Vercel URL |

## First tenant

**Move95** — Fitness studio, Neupré (Belgium)
- Launch target: August 1st, 2026

## Environment variables

Copy `.env.example` and fill in your values:

\`\`\`bash
cp .env.example .env.local
\`\`\`

## License

MIT © Nexxia
