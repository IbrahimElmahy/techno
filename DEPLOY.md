# Deploying techno (frontend on Vercel + backend on Render)

The frontend is already on Vercel: **https://techno-beryl-beta.vercel.app**.
It calls the backend, so the backend must be live on a public HTTPS URL. These steps host it on
**Render** (free) and connect the two. ~10 minutes, no local machine needed afterwards.

## 1) Deploy the backend on Render (gives a permanent HTTPS URL)

1. Go to <https://render.com> → sign up (free, "Sign in with GitHub").
2. **New → Blueprint** → select the repo **`IbrahimElmahy/techno`** → **Apply**.
   Render reads [`render.yaml`](render.yaml) and creates:
   - a **free Postgres** database (`techno-db`), and
   - a **web service** (`techno-backend`) running FastAPI.
3. Wait for the first deploy to go green. On start it auto-creates the schema and seeds demo data.
4. Copy the service URL — it looks like **`https://techno-backend.onrender.com`**.

Demo logins (seeded): `admin`/`admin123` · `accountant`/`acc123` · `manager`/`mgr123` · `rep`/`rep123`
(change these before real production use).

> Free Render web services sleep after ~15 min idle; the first request then takes ~50 s to wake. Fine
> for a demo. Upgrade the plan for always-on.

## 2) Point the Vercel frontend at that backend

1. In **Vercel → project `techno` → Settings → Environment Variables**, add:
   - **Name:** `VITE_API_URL`
   - **Value:** your Render URL, e.g. `https://techno-backend.onrender.com`  (no trailing slash)
   - Environments: Production (and Preview if you want).
2. **Deployments → … → Redeploy** (so the new env var is baked into the build).

The frontend reads `VITE_API_URL` at build time (see `frontend/src/App.tsx`) and calls
`<VITE_API_URL>/api/v1/...`. CORS on the backend already allows `*.vercel.app` and the value in
`FRONTEND_ORIGINS`.

## 3) Verify

- Open <https://techno-beryl-beta.vercel.app/#/login> and log in as `admin` / `admin123`.
- If login hangs on the first try, the free backend is waking up — retry after ~50 s.

## Notes / hardening for real production

- `render.yaml` sets a strong generated `JWT_SECRET` (not the dev default).
- The demo passwords above are for the seeded users — change them (or wipe the seed) before going live.
- The hosted DB is Postgres; the app uses `Base.metadata.create_all` on boot (DB-agnostic). The
  MySQL-only Alembic migrations are not used on Render.
- To change which frontend origins may call the API, edit `FRONTEND_ORIGINS` (comma-separated) on the
  Render service.
