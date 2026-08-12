# Migration provenance

This repository is the standalone SeeON frontend extracted from the SeeON monorepo.
It is a Vite + React SPA. It is not a Next.js app and it does not host the API.

## Frozen baseline

| Field | Value |
| --- | --- |
| Source repository | `https://github.com/SeniorAILab/SeeON.git` |
| Source baseline SHA | `d69c21dfdc6b0af3bddb1fc8ac1a2ff136306c68` |
| Source branch at freeze | `main` (equal to `origin/main` at freeze) |
| Freeze UTC | `2026-08-12T01:41:21Z` |
| Extraction date (UTC calendar) | `2026-08-12` |
| Extraction tool | `git filter-repo` (`a40bce548d2c`) |
| Extraction command | `git filter-repo --path front/ --path-rename front/:` |
| Subtree split used | no |
| Filtered HEAD (imported tip) | `b650a20f52cb8b3946434ffeb6e28abf280c0b1c` |
| Target repository | `https://github.com/SeniorAILab/SeeON-Front` |
| Target visibility | public |
| Working feature branch | `feat/standalone-vercel-migration` |

Source `front/` history count at freeze: 175 commits touching `front/`.
Filtered repository commit count at import tip: 220 (path rewrite retains commits that only partially touched `front/`).

Representative author and timestamp checks (source -> filtered) are recorded in the Todo 2 evidence pack under the parent planning workspace. Oldest, middle, and latest `front/`-touching commits kept author name, author email, author date, and commit date after path rewrite.

## Current legacy origin

Until HTTPS API cutover and source cleanup finish, production traffic for the care dashboard still runs from the existing iwinv host:

- Legacy origin: `http://49.247.204.81`
- Owner surface: monorepo `front/` image + nginx reverse proxy in `SeniorAILab/SeeON`
- Status of this repository's Vercel URL: static shell only (`STATIC_READY`), not full product readiness

Do not point a Vercel HTTPS page at `http://49.247.204.81`. Mixed content and cookie scope break login, SSE, upload, and media Range flows.

## Mirror rule

Any change that lands in source `SeniorAILab/SeeON` under `front/` after baseline `d69c21dfdc6b0af3bddb1fc8ac1a2ff136306c68` and before source `front/` cleanup must be mirrored into this repository.

Mirror means:

1. Identify the source commit(s) that touch `front/`.
2. Replay the equivalent path-rewritten change onto this repository (root paths, not `front/` prefix).
3. Keep product behavior aligned; do not "improve" while mirroring.
4. Record the source SHA in the mirror commit body.

If source and target diverge without a recorded mirror, stop feature work and reconcile before deploy.

## Rollback provenance

| Layer | How to roll back |
| --- | --- |
| This repository tip | `git checkout` / revert to the last known good SHA on `main` or the feature branch |
| Imported history | Filtered history remains in git; removed runtime files stay reachable via `git log --all -- <path>` and `git show <sha>:<path>` |
| Vercel Production | Point Production back to the previous READY deployment SHA in the Vercel project, or unlink Git Integration and keep the last good deployment |
| Care product traffic | Keep serving `http://49.247.204.81` from monorepo deploy until a later cutover issue proves full product readiness |
| Source monorepo | Leave `SeniorAILab/SeeON` `front/`, Jenkins, Compose, and nginx untouched by this migration |

Rollback does not require rewriting filtered history. Do not force-push imported commits.

## Removed monorepo runtime files

These files existed at filtered tip `b650a20f52cb8b3946434ffeb6e28abf280c0b1c` and are removed from the standalone HEAD because Vercel serves the static SPA. nginx API/SSE/upload/Range proxy stays a monorepo/iwinv concern until HTTPS API work lands elsewhere.

- `Dockerfile`
- `nginx.conf`
- `.dockerignore`

History still contains them. Example checks:

```bash
git log --all -- Dockerfile nginx.conf .dockerignore
git show b650a20f52cb8b3946434ffeb6e28abf280c0b1c:Dockerfile
git show b650a20f52cb8b3946434ffeb6e28abf280c0b1c:nginx.conf
git show b650a20f52cb8b3946434ffeb6e28abf280c0b1c:.dockerignore
```

## Readiness labels (do not blur)

| Label | Meaning |
| --- | --- |
| `STATIC_READY` | Fresh clone installs and builds; Vercel serves the SPA shell; deep routes refresh to `index.html` |
| Full product readiness (do not claim yet) | HTTPS API, CORS/cookies, login, SSE, upload, media Range, and RBAC all pass on the real Production URL |

This migration claims at most `STATIC_READY` after Vercel deploy. It does not claim full product readiness.

## Vercel agent skill audit

Pinned upstream commit audited: `7c180d9044c9ae2b442b567aad4e42a28dd5ed62` in `https://github.com/vercel-labs/agent-skills`.

| Check | Result |
| --- | --- |
| Commit resolves | yes (merge `fix-install-command`, 2026-07-24) |
| Skill path | `skills/react-best-practices/` |
| License on SKILL.md | MIT |
| Provenance | official `vercel-labs/agent-skills`, verified GitHub commit signature on the pin |
| Framework fit | **not compatible** with this repo |

Why it is not committed here:

1. The skill targets React **and Next.js** (RSC, server actions, `next/dynamic`, App Router patterns). This app is Vite + client-side React only.
2. Server-side rule categories would push agents toward SSR/RSC refactors that this migration forbids.
3. Committing the pack would create a false local SSOT and invite product refactors outside docs ownership.
4. Plan scope allows the pin only when compatible and provenance-safe. Provenance is fine; compatibility is not.

How to use it without a committed copy:

```bash
git clone https://github.com/vercel-labs/agent-skills.git
cd agent-skills
git checkout 7c180d9044c9ae2b442b567aad4e42a28dd5ed62
# read skills/react-best-practices/SKILL.md and rules/* as external reference only
```

Apply only client-side guidance that fits a Vite SPA (bundle imports, re-render hygiene, list rendering). Ignore Next.js server rules. Do not use the skill to justify unrelated refactors in this repository.

## Related docs

- API ownership and change sequencing: `CONTRACT.md`
- Day-to-day agent rules: `AGENTS.md`
- Human quick start: `README.md`
