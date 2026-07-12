# Routes Map

Date: 2026-07-11

## Frontend Routes

| Route | Component | Access |
| --- | --- | --- |
| `/login` | `Login` | Public |
| `/connexion` | `Login` | Public |
| `/inscription` | `Login initialView=register` | Public |
| `/mot-de-passe-oublie` | `Login initialView=forgot` | Public |
| `/rejoindre-une-reunion` | `GuestJoinPage` | Public |
| `/dashboard` | redirect to `/app` | Public redirect |
| `/admin` | `AdminDashboardPage` | Frontend protected; backend admin APIs protected |
| `/reunions/recentes` | redirect to `/app?tab=reunions` | Public redirect |
| `/aide` | `SimpleInfoPage` | Public |
| `/securite` | `SimpleInfoPage` | Public |
| `/fonctionnalites` | `SimpleInfoPage` | Public |
| `/reunions/terminee` | `MeetingEndedPage` | Mixed: state-based or authenticated lookup |
| `/reunions` | `MeetingList` | Protected |
| `/reunions/:meetingId/salle-attente` | `GuestWaitingRoomPage` | Guest/auth state required in component |
| `/reunions/:meetingId/terminee` | `MeetingEndedPage` | Mixed: state-based or authenticated lookup |
| `/reunions/:meetingId/luna` | `GuestMeetingPage` | Auth required in component |
| `/reunions/:meetingId` | `GuestMeetingPage` | Auth required in component |
| `/` | redirect to `/app` | Public redirect |
| `/app` | `UserDashboardPage` | Protected |
| `/join` | `MeetingJoinPage` | Protected |
| `/join/:meetingLink` | `MeetingJoinPage` | Protected |
| `*` | redirect to `/app` | Public redirect |

## Backend Routes

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/health` | Public |
| GET | `/api/public/meetings` | Public |
| POST | `/api/auth/register` | Public |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/guest-join` | Public |
| GET | `/api/auth/me` | Auth |
| POST | `/api/auth/logout` | Auth |
| GET | `/api/admin/dashboard` | Auth + admin |
| GET | `/api/admin/search` | Auth + admin |
| POST | `/api/admin/meetings/:meetingId/join` | Auth + admin |
| GET | `/api/meetings` | Auth |
| POST | `/api/meetings` | Auth |
| GET | `/api/meetings/participant-suggestions` | Auth |
| POST | `/api/meetings/join-lookup` | Auth |
| GET | `/api/meetings/link/:meetingLink` | Auth |
| PUT | `/api/meetings/:meetingId` | Auth + meeting moderator |
| DELETE | `/api/meetings/:meetingId` | Auth + meeting moderator |
| GET | `/api/meetings/:meetingId/lobby` | Auth |
| POST | `/api/meetings/:meetingId/join-request` | Auth |
| POST | `/api/meetings/:meetingId/start-notify` | Auth + meeting moderator |
| POST | `/api/meetings/:meetingId/lobby/respond` | Auth + meeting moderator |
| POST | `/api/meetings/:meetingId/media-requests` | Auth + meeting access |
| GET | `/api/meetings/:meetingId/media-requests` | Auth + meeting access |
| POST | `/api/meetings/:meetingId/media-requests/:requestId/respond` | Auth |
| POST | `/api/ai/luna` | Auth |
| GET | `/api/actus/events` | Auth |

## Route Issues

- Several sidebar/admin/dashboard links point to future routes that currently fall through to `*` and redirect to `/app`.
- Admin backend has dashboard/search/join but not full users, reports, bans, audit logs, recordings, integrations, or storage endpoints yet.
- Public reset-password and OTP backend routes are missing.
