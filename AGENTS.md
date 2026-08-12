# Frontend agent rules: Vite 5 + React 18 + TypeScript strict dashboard

Standalone repository: `SeniorAILab/SeeON-Front`.
There is no parent monorepo workspace. Root scripts replace the old workspace filter form.

## Layout

```
src/
├── features/            # feature folders (monitor, admin-events, dashboard):
│                        # components/hooks/pages/services/stores + index.ts public API
├── services/
│   ├── api/             # endpoint mappers: backend DTO validation + domain mapping
│   └── *.ts             # service workflows
├── types/               # index.ts = frontend type mirror of PRD/API contract
├── pages/ components/   # views (shared/cross-feature only; see Guards)
├── hooks/ stores/       # reusable hooks and zustand state (shared/cross-feature only)
├── lib/                 # utilities
├── router.tsx main.tsx  # entry
└── test/
```

Read `src/AGENTS.md` before changing application code under `src/`.
Read `CONTRACT.md` before changing anything that talks to the backend.
Read `MIGRATION.md` before claiming deploy readiness or replaying source `front/` changes.

## Guards

- Feature-internal code under `features/<name>/**` is imported from outside the
  feature only via that feature's `index.ts` public API. Shared/cross-feature
  code (types, stores such as `monitorStore`, `authStore`, `facilityStore`,
  `uiStore`, `components/ui`, `components/status/**`, layouts, `lib/*`,
  services core) stays in the type-based layers and is never moved into
  `features/`. Carve-out: `*.test.*` files may deep-import feature internals
  directly for mocking/fixtures (e.g. `vi.mock("@/features/monitor/pages/...")`);
  production code must always go through the barrel.
- Components never call the backend directly. Go through `src/services/*` (the API seam).
- Backend endpoint calls live under `src/services/api/*`; service files consume endpoint functions instead of scattering `fetch()` or backend JSON casts.
- `src/types/index.ts` mirrors the PRD/API contract for frontend code. Wire SSOT is backend OpenAPI (see `CONTRACT.md`).
- Dev/prod/test runtime uses the real backend API seam. Do not reintroduce
  frontend mock auth users, localStorage auth sessions, or runtime demo branches.
- Login in dev/prod is backend-owned email/password auth. It must mint the
  same httpOnly backend JWT cookie and restore via `/api/v1/auth/me`. Do not
  reintroduce frontend mock auth users or localStorage auth sessions.
- `src/data/mockData.ts` was deleted; `src/services/db.ts` was deleted; `src/services/adminService.ts` was deleted. Never reintroduce runtime mock/fixture islands; new or reactivated pages must wire to the real backend.
- `strictPort` 3000 (ADR); pnpm only, never an npm lockfile.
- Do not add Docker/nginx runtime files back for Vercel hosting. Legacy `Dockerfile`, `nginx.conf`, and `.dockerignore` remain in git history only (see `MIGRATION.md`).
- Do not claim full product readiness until HTTPS API, CORS/cookies, login, SSE, upload, media Range, and RBAC pass on the real Production URL. Static deploy is `STATIC_READY` only.

## Run

Run every command from this repository root. Node 24.x and `pnpm@10.32.1` are the expected toolchain once the package lane lands.

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm test
pnpm build
pnpm preview
```

Do not use workspace filter commands against a package named `front`. That form belongs to the old monorepo only.

## Design and docs ownership

- Visual tokens and component rules: `DESIGN.md` (this file is the design SSOT in the standalone repo).
- Human product overview and quick start: `README.md`.
- Extraction baseline, mirror rule, rollback, skill audit: `MIGRATION.md`.
- API sequencing and forbidden shortcuts: `CONTRACT.md`.

## External React guidance

Official Vercel `react-best-practices` at commit `7c180d9044c9ae2b442b567aad4e42a28dd5ed62` was audited and **not** committed. It is Next.js/RSC-heavy and not a safe default for this Vite SPA. Use it only as an external reference for client-side tips. Details and clone commands live in `MIGRATION.md`.
