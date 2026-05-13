# Deployment GymBook Dashboard

## Environments

| Branch  | Environment | URL                          | Supabase        |
|---------|-------------|------------------------------|-----------------|
| develop | Staging     | gymbook-app-*.vercel.app     | gymbook-staging |
| main    | Production  | dashboard.move95.be          | gymbook-prod    |

## Deployment process

1. Push to `develop` -> automatic Vercel staging deployment
2. Visual tests on Vercel preview URL
3. Merge `develop` -> `main` at end of each sprint
4. `main` -> automatic production deployment

## Environment variables (Vercel)

Set these in Vercel -> Settings -> Environment Variables:

| Variable               | Staging                                          | Production |
|------------------------|--------------------------------------------------|------------|
| VITE_SUPABASE_URL      | https://buovgpokubrkejunmauq.supabase.co         | (prod URL) |
| VITE_SUPABASE_ANON_KEY | (staging anon key)                               | (prod key) |
| VITE_APP_ENV           | staging                                          | production |
| VITE_APP_VERSION       | 0.1.0-sprint1                                    | 0.1.0      |

## Build

```bash
# From repo root
npm run build

# From apps/dashboard
npm run build
```

Output: `apps/dashboard/dist/`

## SPA routing

The `vercel.json` rewrite rule ensures all routes return `index.html`:
```json
{ "source": "/(.*)", "destination": "/index.html" }
```

Without this, direct navigation to `/planning`, `/settings` etc. returns 404.

## Rollback

In case of production issue:
Vercel -> Deployments -> Select previous version -> Promote

## Post-deployment checklist

- [ ] `/login` page renders correctly
- [ ] Login with gym_admin account works
- [ ] Navigation `/dashboard` `/planning` `/settings` OK
- [ ] No console errors in production
- [ ] Dark mode toggle works
- [ ] Language switch FR/EN works
- [ ] Supabase connection (RLS) works

## RLS security tests

```bash
npm run test:rls
```

Must pass 23/23 before any production deployment.

## Bundle analysis

Target: < 500KB gzipped total.
Current: ~300KB gzipped (21 chunks with code splitting).
