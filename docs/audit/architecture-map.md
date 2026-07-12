# MBoteRoom Architecture Map

Date: 2026-07-11

## Stack Identified

- Frontend: React 19, TypeScript, Vite, React Router 7.
- Styling: plain CSS files imported per page/component plus `src/index.css`.
- Backend: Express in `server.ts`.
- Realtime: Socket.IO server in `server.ts`, Socket.IO client in `src/lib/socket.ts`.
- WebRTC: native WebRTC mesh in `src/hooks/useMeetingMeshWebRTC.ts`.
- Database/persistence: in-memory maps persisted to `data/mbote-room-db.json`; optional PostgreSQL through `pg` and `DATABASE_URL`.
- Auth: bearer token sessions stored server-side as hashed session tokens; frontend currently stores `user` and `token` in localStorage.
- Build: Vite client build plus esbuild bundle for `server.ts`.

## Main Directories

- `src/components`: reusable meeting components and existing meeting manager.
- `src/pages`: auth, guest join, guest meeting, waiting room, ended meeting, user dashboard, admin dashboard.
- `src/services`: frontend API clients for auth, meetings, public settings, admin dashboard.
- `src/hooks`: WebRTC meeting mesh hook.
- `src/lib`: API URL helpers, Socket.IO client, WebRTC config, navigation helpers.
- `server.ts`: backend API, auth, persistence, Socket.IO, static serving.
- `scripts/dev.mjs`: local dev orchestration.
- `docs`: project docs and this audit folder.
- `data`: local JSON database.

## Frontend To Backend Flow

1. Frontend calls `apiUrl('/api/...')`.
2. In Vite dev, `/api` proxies to `localhost:3004`.
3. In production bundle, Express serves static assets and handles `/api`.
4. Authenticated requests use `Authorization: Bearer <token>` from localStorage/sessionStorage.

## Authentication Flow

- Register: `POST /api/auth/register`.
- Login: `POST /api/auth/login`.
- Guest join: `POST /api/auth/guest-join`.
- Current user: `GET /api/auth/me`.
- Logout: `POST /api/auth/logout`.
- Server stores only token hashes in sessions.
- Frontend stores the raw token locally. This is functional but remains a security hardening item if HTTP-only cookies are introduced later.

## Meeting Flow

- Create/update/delete meetings through `/api/meetings`.
- Meeting lookup by link or join lookup.
- Guest join can create a guest account and lobby request.
- Waiting room uses `/api/meetings/:meetingId/lobby` and `/lobby/respond`.
- Live meeting uses `GuestMeetingPage` plus `useMeetingMeshWebRTC`.
- Ended meeting page receives state from the live meeting and can load meeting data for authenticated users.

## Realtime Flow

- Socket connects to `getSocketUrl()`.
- Meeting WebRTC room join emits `meeting:join`.
- Server keeps per-meeting socket participants in memory.
- SDP/ICE relayed through `meeting:offer`, `meeting:answer`, `meeting:ice-candidate`.
- Chat and hand raising are relayed through Socket.IO.
- Dashboard/admin listen for meeting lifecycle events emitted by REST mutations.

## Admin Flow

- `/admin` is protected by frontend auth guard.
- Backend admin endpoints are protected by `authenticateToken` and `requireAdmin`.
- Current bootstrap admin rule: first user id `1` or email listed in `ADMIN_EMAILS`.
- Fine-grained roles/permissions are exposed conceptually but not fully stored in the database yet.

## Current Technical Debt

- No dedicated migrations system; PostgreSQL schema is created directly in `server.ts`.
- No automated test script in `package.json`.
- `tsconfig.json` has `strict: true` but `noImplicitAny: false`.
- Several business modules requested by the prompt are not implemented yet: friendships, full messaging persistence, notifications persistence, recordings, reports, bans, audit logs, calendar storage, integrations, storage usage.
- Some UI routes are placeholder-style informational pages or navigation targets without full pages.
- Admin role model is bootstrap-level, not a durable RBAC schema.
