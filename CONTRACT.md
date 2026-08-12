# Frontend / backend contract

## Single source of truth

Backend OpenAPI is the API SSOT for this frontend.

| Surface | Owner | Location |
| --- | --- | --- |
| HTTP routes, request/response shapes, auth | Backend | `SeniorAILab/SeeON` generated OpenAPI (`/api/docs`) and committed snapshot `docs/openapi/v1.json` in that monorepo |
| Controllers that emit the contract | Backend | `backend/src/**/*.controller.ts` in `SeniorAILab/SeeON` |
| Browser UI types | This repo | `src/types/index.ts` (view/domain mirror, not wire SSOT) |
| Fetch, cookies, 401 handling | This repo | `src/services/apiClient.ts` and `src/services/api/*` |
| Route tree and facility scope UX | This repo | `src/router.tsx` and guards under `src/components/` |

When OpenAPI and a frontend type disagree, OpenAPI wins. Fix the frontend mapper or open a backend change. Do not "fix" production behavior by inventing a parallel client contract.

This repository does not vendor OpenAPI, shared DTO packages, or codegen. Mappers under `src/services/api/*` stay hand-written against the published backend contract.

## Runtime assumptions

- Browser calls go through `src/services/*` only. Components and pages never call `fetch` on backend URLs directly.
- Default local API base is the relative path `/api/v1` (dev proxy or same-origin gateway).
- Production must use an absolute HTTPS `VITE_API_BASE_URL` once API ingress exists. An HTTPS page must not call `http://49.247.204.81`.
- Session auth is the backend httpOnly `app_session` JWT cookie restored via `GET /api/v1/auth/me`.
- Facility scope: facility-bound users use JWT `facilityId`. `SUPER_ADMIN` sends `X-Facility-Id` on fetch/XHR and `facilityId` query on native `EventSource`.
- Dashboard realtime is `GET /api/v1/dashboard/stream` (SSE). Upload and media Range stay backend+gateway concerns, not Vercel rewrites.

Exact env names and examples are owned by the env-contract lane (`.env.example`, `src/vite-env.d.ts`). This file states product rules only.

## Cross-repository API change sequencing

Coordinate backend and frontend in this order. Never reverse it for "speed".

### A. Additive backend change (new route or optional field)

1. Land backend OpenAPI + controller + tests in `SeniorAILab/SeeON`.
2. Publish/deploy backend so the new shape is live in the target environment.
3. Update this repo's `src/services/api/*` mapper and any UI that consumes it.
4. Deploy this frontend after the backend is already serving the additive shape.

### B. Breaking backend change (rename, remove, stricter validation)

1. Write the migration plan and dual-read/dual-write window if needed.
2. Prefer a new versioned path or additive field first; avoid silent meaning changes on existing paths.
3. Update OpenAPI in backend with explicit deprecation notes.
4. Ship frontend against the new contract while backend still accepts the old one if a window is required.
5. Only then remove the old backend path/field.
6. Never deploy a frontend that requires a backend response the live API does not yet emit.

### C. Frontend-only UX change (no wire change)

1. Keep mappers and DTO parsing stable.
2. Change UI, copy, or local view models only.
3. No backend PR required.

### D. Forbidden shortcuts

- No direct component `fetch` bypassing `src/services/*`.
- No mock auth users, localStorage session auth, or runtime demo backend.
- No API semantic drift ("the UI treats 404 as empty list") without an OpenAPI change.
- No uncoordinated backend deploy that breaks the live frontend contract.
- No shared npm DTO package and no OpenAPI codegen gate in this repository for this migration.
- No Vercel rewrite/proxy of `/api`, SSE, upload, or media through the frontend project.

## Facility scope and RBAC

- Canonical UI routes are facility-scoped: `/facilities/:facilityId/...`.
- Legacy `/dashboard/*` and `/admin/*` paths are redirect-only compatibility shims.
- Frontend route guards are UX. Final authorization is backend `JwtAuthGuard`, `RequireFacilityGuard`, `RolesGuard`, and capability checks.

## Readiness boundary

Contract compliance in code does not mean the Vercel Production URL is product-ready. Login, SSE, upload, media Range, and RBAC against a real HTTPS API are tracked as follow-up work. Until that work passes, label the deployment `STATIC_READY` only. Never declare full product readiness from docs alone.

## Failure posture

When the API base is missing, wrong, or still HTTP on an HTTPS page:

- Show the existing error/empty/unauthorized UI.
- Do not invent a mock success path.
- Do not silently fall back to the legacy VM origin.
