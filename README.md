# Dr. (Major) Amlan's ENT Clinic — Backend

Express + TypeScript backend for the clinic website. This repository is deployed as a **separate Vercel project** from the frontend SPA.

## What this backend does

- **Appointments**
  - Slot availability (`GET /api/appointment/available-slots`)
  - Appointment search and clinic status
- **Payments (PhonePe)**
  - Create payment orders (`POST /api/payment/create-order`)
  - Status polling endpoints used by the frontend after redirect
  - Webhook processing (`POST /payment/webhook`) with SDK validation and idempotency
- **Admin**
  - Protected endpoints under `/api/protected/*` using Firebase ID token verification + admin email allowlist
- **Media**
  - Cloudinary upload/replace/delete flows under `/api/cloudinary/*`

## Tech stack

- Runtime: **Bun** (scripts), **Vercel** serverless deployment
- Server: **Express 5**
- Language: **TypeScript**, ESM (`"type": "module"`)
- TS module resolution: **NodeNext** (`module` / `moduleResolution`: `nodenext`)
- Security: Helmet, CORS allowlist, rate limiting, request size validation, geo gate
- Integrations: Firebase Admin SDK, PhonePe PG SDK, Cloudinary

## Important compatibility note (PhonePe)

This project pins `class-transformer` to **0.3.2** via `package.json` `overrides` to avoid known runtime incompatibilities with the PhonePe SDK dependency chain.

## Running locally

```bash
bun install
bun run dev
```

Build:

```bash
bun run build
```

Lint:

```bash
bun run lint
```

## Environment variables

Copy `.env.example` → `.env` for local development. Do **not** commit real secrets.

### Core

- `NODE_ENV` — `development` / `production`
- `PORT` — local dev only (Vercel provides the serverless runtime)
- `ENABLE_DEBUG_LOGS` — set to `true` to log extra details in some payment/webhook paths

### Frontend origins (CORS + redirects)

Used for CORS allowlist and redirect/callback URLs.

- `FRONTEND_LOCAL` — e.g. `http://localhost:5173`
- `FRONTEND_VERCEL` — preview URL pattern/host (optional)
- `FRONTEND_DNS` — primary frontend domain used in redirects (e.g. `https://www.example.com`)
- `FRONTEND_ROOT` — apex domain (optional)

### Firebase Admin

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` — keep newlines escaped as `\n` in env; code converts to real newlines at runtime

### Admin allowlist (server-side enforcement)

- `ADMIN_EMAIL1`
- `ADMIN_EMAIL2`

### PhonePe

- `PHONEPE_CLIENT_ID`
- `PHONEPE_CLIENT_SECRET`
- `PHONEPE_CLIENT_VERSION` — numeric
- `PHONEPE_ENV` — `SANDBOX` or `PRODUCTION`
- `PHONEPE_WEBHOOK_USERNAME`
- `PHONEPE_WEBHOOK_PASSWORD`

### Cloudinary

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

## Key routes (high level)

- Public health:
  - `GET /health`
  - `GET /webhook-health`
- Public APIs:
  - `/api/appointment/*`
  - `/api/payment/*`
- Webhooks:
  - `POST /payment/webhook`
- Protected admin APIs:
  - `/api/protected/*`

## Repository

Git remote (from `package.json`): `https://github.com/debbarmaatanu-dev/dr_amlan-s_ent_clinic_backend`

## License

**PROPRIETARY — NOT OPEN SOURCE**
