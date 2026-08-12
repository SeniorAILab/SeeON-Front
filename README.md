# SeeON Front · 케어 모니터링 대시보드

요양원 CCTV 영상을 **직접 노출하지 않고**, AI가 분석한 결과만 방·공간 단위 카드 UI로 보여주는 안전 모니터링 대시보드입니다. "감시"가 아닌 "안전 확인" 톤으로 설계되었습니다.

기준 시설: **행복한요양원 녹양역점** · 멀티테넌트(여러 시설) 확장 구조.

이 저장소는 `SeniorAILab/SeeON` monorepo의 `front/` 이력을 보존한 독립 Vite + React SPA입니다. 추출 기준, mirror 규칙, rollback은 `MIGRATION.md`를 보세요. API 소유권과 변경 순서는 `CONTRACT.md`를 보세요.

## 현재 readiness

| Label | 이 저장소 상태 |
| --- | --- |
| `STATIC_READY` | 목표: 루트에서 설치·빌드·정적 배포(SPA shell + deep route refresh) |
| Full product readiness | **아직 주장하지 않음**. HTTPS API, CORS/쿠키, 로그인, SSE, upload, media Range, RBAC가 실제 Production URL에서 통과하기 전까지 금지. 문서/배포만으로 이 단계를 선언하지 마세요. |

Vercel에 올라간 URL이 있어도 로그인·실시간·미디어가 동작한다고 단정하지 마세요. 레거시 운영 원본은 당분간 `http://49.247.204.81` (monorepo iwinv)입니다. HTTPS 페이지에서 그 HTTP 원본을 API로 쓰지 마세요.

---

## 빠른 시작

저장소 **루트**에서 실행합니다. 부모 monorepo workspace filter는 필요 없습니다.

```bash
# 기대 toolchain: Node 24.x, pnpm@10.32.1 (package lane이 lock/engines를 맞춘 뒤)
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm preview
```

로컬 API 연동은 dev 서버가 `/api`를 백엔드 origin으로 proxy합니다(환경 계약은 env lane 문서·`.env.example` 기준). 백엔드가 없으면 정적 shell과 UI는 뜨지만 인증·데이터 호출은 기존 오류 UI로 실패하는 것이 정상입니다. mock으로 초록불을 만들지 마세요.

### 로그인

dev/prod 로그인은 백엔드가 소유합니다. 이메일/비밀번호는 `POST /api/v1/auth/login`으로
처리하며, 백엔드가 httpOnly `app_session` JWT 쿠키를 만든 뒤 프론트가 `GET /api/v1/auth/me`로
복원합니다. 처음 로그인한 계정이 아직 시설에 연결되지 않았다면 `/onboarding`에서
`POST /api/v1/facilities`로 시설을 등록합니다.

로컬 seed 계정은 `super@sen.ai`, `admin@sen.ai`, `staff@sen.ai`이며 비밀번호는
백엔드 seed 환경변수에서 옵니다. 운영 seed에는 조용한 기본 비밀번호가 없습니다. 비밀번호를 이 저장소에 적지 마세요.

---

## 사용자 모드 분리 (현장 직원 우선 UX)

실제 주 사용자는 60대 이상 요양보호사·간호조무사·사회복지사·야간 근무자입니다. "멋진 대시보드"가 아니라 **3초 안에 위험을 이해하고 바로 행동하는 안전 확인 도구**로 설계했습니다.

### 직원 모드 (시설 스코프)

Canonical 경로:

- `/facilities/:facilityId/dashboard` · 지금 확인할 곳
- `/facilities/:facilityId/floor/:floorId` · 층별 현황
- `/facilities/:facilityId/alerts` · 확인한 알림

레거시 `/dashboard`, `/dashboard/floor/:floorId`, `/dashboard/alerts`는 redirect 전용입니다. 새 화면을 레거시 경로에 추가하지 마세요.

- **지금 확인할 곳**: 로그인 후 첫 화면. 위험/주의/확인필요 공간만 위험 우선 큰 카드. 모두 안정이면 "지금은 모든 곳이 안정적입니다" 안내.
- **전체 방 상태**: 큰 층 탭 + 큰 카드.
- **확인한 알림**: 처리 완료된 알림 이력.
- **큰 글자·큰 버튼**: 공간명 28px, 상태 24px, 설명 19px, 버튼 21px·높이 56px+ (장갑 착용 대응). 색상 + 한글 문구 + 아이콘을 함께 사용(색약 대응).
- **조치 버튼 3개만**: 확인 완료 / 직원 방문 중 / 도움 요청. 추가 메모는 접어둠.
- **현장 문구만**: AI·confidence·detection·camera ID 같은 용어를 직원 화면에서 제거. "침대 주변 움직임이 많습니다" 식 한글 안내(`src/lib/staffCopy.ts`).
- **다크모드**: 야간(19~07시) 자동 다크 + 토글. 토큰(CSS 변수) 기반이라 모든 화면이 함께 전환됩니다.
- **소리·진동**: 새 위험 발생 시에만 부드러운 알림음 + 진동(토글 가능, `src/lib/alert.ts`).

### 관리자 모드 (`/facilities/:facilityId/admin/*`)

상세 이벤트, 시설/층/공간, 모니터 설정, 사용자, edge enrollment 등이 여기 모입니다. 레거시 `/admin/*`는 redirect 전용입니다. 화면 경로는 프론트 라우트이고, HTTP 계약은 백엔드 OpenAPI가 SSOT입니다(`CONTRACT.md`). 관리자 화면은 항상 라이트 모드.

---

## 이슈 근거 영상 (관리자 전용) · 보안 우선

이 기능은 **"실시간 CCTV 관제"가 아니라 "AI 위험 감지 근거 영상 확인"**입니다. AI가 위험으로 감지한 **이벤트 구간(감지 10초 전 ~ 10초 후, 약 20초)** 클립만 관리자에게 제공합니다.

- **권한 분리**: STAFF는 영상 영역 자체가 없고 "영상은 관리자만 확인할 수 있습니다" 안내만 표시. ADMIN/SUPER_ADMIN만 이벤트 상세(`/facilities/:facilityId/admin/events/:eventId`)에서 근거 UI를 볼 수 있습니다.
- **현재 백엔드 계약**: 영상 presign/access-log 전용 API는 아직 없을 수 있습니다. 스냅샷·미디어는 OpenAPI에 게시된 경로만 사용합니다.
- **프론트 보안 경계**: 프론트 라우트 가드는 UX 목적입니다. 최종 권한은 백엔드 JWT/facility/RBAC 가드가 강제합니다.

---

## 기술 스택

React 18 · TypeScript(strict) · Vite · Tailwind CSS · Zustand · React Router · Recharts · Lucide Icons. shadcn 톤의 경량 UI 프리미티브를 직접 구현해 외부 CLI 의존성을 없앴습니다.

호스팅 목표는 Vercel static SPA입니다. 이 저장소 HEAD에는 Docker/nginx 런타임 파일이 없습니다(이력이 보존). API/SSE/upload/Range reverse proxy는 monorepo/iwinv 또는 향후 HTTPS API ingress 몫입니다.

---

## 폴더 구조

```
src/
├── types/index.ts          프론트 UI/domain 타입
├── lib/                    utils · labels · roles · format
├── services/               API/서비스 레이어
│   ├── apiClient.ts        fetch 래퍼 (`/api/v1`, cookie credentials, X-Facility-Id)
│   ├── api/                백엔드 endpoint mapper
│   ├── authService.ts      로그인/세션 복원
│   ├── dashboardService.ts 대시보드/공간 상태
│   └── eventService.ts     이벤트 확인/조치
├── stores/                 authStore · facilityStore · monitorStore 등
├── components/             layout, status board, ui primitives ...
├── features/               dashboard · monitor · admin-events (barrel `index.ts`)
├── pages/                  Login, admin pages, ...
└── router.tsx              facility-scoped canonical routes + legacy redirects
```

---

## 데이터 모델

프론트 타입은 `src/types/index.ts`의 UI/domain view입니다. 영속 모델과 HTTP 표면은 백엔드(Prisma + controllers + OpenAPI)가 소유합니다. `SpaceStatus`, `DetectionEvent`, `AlertRule`, `ResidentRiskSummary`, `VideoClip` 등 일부 프론트 타입은 화면 호환용일 수 있으며, 동명 CRUD route가 있다는 뜻이 아닙니다. 판단이  lag면 `CONTRACT.md`와 백엔드 OpenAPI를 보세요.

---

## 백엔드 연동 계약 (요약)

기본 개발 런타임은 실제 백엔드 경로입니다. `src/services/apiClient.ts`가 `VITE_API_BASE_URL`(로컬 기본 `/api/v1`)로 요청하고 `credentials: "include"`를 붙입니다.

### 인증·시설 스코프

- 이메일/비밀번호: `POST /api/v1/auth/login`
- 부트스트랩: `GET /api/v1/auth/me`
- 로그아웃: `POST /api/v1/auth/logout`
- 회원가입/초기 시설 생성: `POST /api/v1/auth/register`
- 온보딩 시설 생성: `POST /api/v1/facilities`
- 시설 목록/상세: `GET /api/v1/facilities`, `GET /api/v1/facilities/:id`

브라우저 세션은 백엔드가 발급한 httpOnly `app_session` JWT 쿠키입니다. 프론트 localStorage 세션은 계약이 아닙니다. 시설-bound 사용자는 JWT의 `facilityId`가 스코프이고, `SUPER_ADMIN`은 fetch/XHR에서 `X-Facility-Id`, native `EventSource`에서 `facilityId` query param으로 선택한 시설을 전달합니다.

### 실시간

대시보드 실시간 반영은 `GET /api/v1/dashboard/stream` SSE입니다. `buildSseUrl(facilityId)`는 `EventSource` 제한 때문에 `?facilityId=<id>` query를 사용합니다.

변경 순서, 금지 사항, SSOT 위치는 `CONTRACT.md`가 정본입니다.

---

## 층별 대형 모니터 현황판 (Floor Monitor Mode)

각 층 간호사실·복도·야간 스테이션의 큰 모니터/TV에 **상시 띄워두는** 화면입니다. 실제 CCTV 영상은 없지만 인원·움직임·위험도·메시지·감지시각이 자동으로 갱신됩니다.

- **경로**: `/facilities/:facilityId/dashboard`, `/facilities/:facilityId/floor/:floorId`, `/facilities/:facilityId/alerts`.
- **멀리서도 보이는 대형 타이포**: 공간명 42px+, 인원 56px+, 상태 36px+, 설명 28px+.
- **마우스 없이 자동 갱신**: dashboard SSE와 알림 REST read-model. 위험/확인 필요는 확인 완료 전까지 유지.
- **조작 최소화**: 층 선택 / 전체 화면 / 알림음 / 카드 클릭 상세. 관리자 메뉴는 노출하지 않습니다.
- **관리자 설정**: `/facilities/:facilityId/admin/monitor-settings` (이 브라우저에 저장).

**연동**: `src/stores/monitorStore.ts`가 SSE와 알림 REST를 합칩니다. 컴포넌트에서 직접 fetch하지 마세요.

### 적응형 레이아웃

- **주의(CAUTION)**: 톤만 변경, 크기 유지.
- **위험/확인 필요(DANGER/CHECK_NEEDED)**: 히어로 타일 + 펄스 테두리. 전체 화면 오버레이 없음.
- **자동 복귀 금지**: 위험/확인 필요는 확인 완료 전까지 유지.

컴포넌트: `src/components/status/RoomStatusTreemap.tsx`, `src/components/status/RoomActionPanel.tsx`.

### TTS 음성 안내

헤더 "음성 안내" 토글(기본 꺼짐). 브라우저 `SpeechSynthesis` MVP. Provider 교체는 `src/features/monitor/services/tts/*` 인터페이스만 구현합니다. 첫 음성은 사용자 제스처 이후(자동재생 정책).

---

## 개발 원칙

- **PoC First · SaaS Ready · Privacy First · Camera Agnostic · Senior-Friendly**
- 핵심 엔티티는 시설 스코프(`facilityId`). API는 cookie JWT + `X-Facility-Id` / SSE `facilityId` 계약.
- 얼굴 인식 미사용. 로그인·온보딩·회원가입에 안내(`PrivacyNotice`).
- 컴포넌트 → services → api mappers 한 방향. OpenAPI와 다른 의미를 UI에서 만들지 않음.

### 로드맵(미구현) 메모

구역/침대 배정 UI, 관심 어르신 UI 등은 라우트에 없을 수 있습니다. 백엔드 route가 준비되면 facility-scoped admin 아래에 배선합니다. 구현 전에 `CONTRACT.md` 순서를 따르세요.

---

## 보안 · 개인정보

- CCTV 원본 스트림을 프론트에 두지 않습니다. AI 분석 결과(상태·요약)와 허용된 근거 클립만.
- 라우트 가드는 UX. 서버 권한 검증이 최종 방어선.
- 세션은 httpOnly JWT 쿠키. localStorage auth 금지.
- 카피: "감시/추적/관제" 대신 "안전 확인/돌봄 지원".

---

## 알려진 제약

- 독립 저장소 HEAD는 패키지/환경/CI lane 통합 전에는 문서상 기대 명령과 lockfile 상태가 어긋날 수 있습니다. package/env/ci lane 병합 후 루트 `pnpm install --frozen-lockfile`이 기준이 됩니다.
- Docker/nginx 파일은 standalone 호스팅 때문에 제거되었습니다. 내용이 필요하면 `git show b650a20f52cb8b3946434ffeb6e28abf280c0b1c:nginx.conf` 등으로 이력을 보세요.
- Vercel Production URL은 `STATIC_READY` 검증 대상이며, 인증된 E2E는 HTTPS API 후속 이슈 범위입니다.

---

## 문서 지도

| 문서 | 내용 |
| --- | --- |
| `MIGRATION.md` | 소스 SHA, 추출, mirror, rollback, 레거시 origin, skill 감사 |
| `CONTRACT.md` | OpenAPI SSOT, API 변경 순서, 금지 단축 |
| `AGENTS.md` | 에이전트 가드와 루트 명령 |
| `DESIGN.md` | 디자인 토큰·컴포넌트 규칙 |
| `src/AGENTS.md` | `src/` 코드 규칙 |

## 개발에 쓰는 외부 가이드

Vercel `react-best-practices`(pin `7c180d9044c9ae2b442b567aad4e42a28dd5ed62`)는 감사 후 **커밋하지 않았습니다**. Next.js/RSC 비중이 커서 이 Vite SPA 기본 규칙으로 쓰기 위험합니다. 필요하면 upstream을 그 커밋으로 checkout해 참고만 하세요. 이유는 `MIGRATION.md`에 있습니다.
