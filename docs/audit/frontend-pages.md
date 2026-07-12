# Frontend Pages Inventory

Date: 2026-07-11

| Page/component | File | Route | Data/API | Status |
| --- | --- | --- | --- | --- |
| Login / register / forgot | `src/pages/Login.tsx` | `/login`, `/connexion`, `/inscription`, `/mot-de-passe-oublie` | `authService` | Functional. Forgot password UI exists, backend reset flow still missing. |
| Guest join | `src/pages/GuestJoinPage.tsx` | `/rejoindre-une-reunion` | `authService.guestJoin`, public meetings | Functional. |
| Guest waiting room | `src/pages/GuestWaitingRoomPage.tsx` | `/reunions/:meetingId/salle-attente` | `meetingService.getLobby` | Functional. |
| Guest/user meeting | `src/pages/GuestMeetingPage.tsx` | `/reunions/:meetingId`, `/reunions/:meetingId/luna` | `meetingService`, Socket.IO, WebRTC | Functional with native WebRTC mesh. |
| Meeting ended | `src/pages/MeetingEndedPage.tsx` | `/reunions/:meetingId/terminee`, `/reunions/terminee` | `meetingService`, location state | Functional. Some exports are local TXT until backend exports exist. |
| User dashboard | `src/pages/dashboard/UserDashboardPage.tsx` | `/app` | `meetingService`, Socket.IO | Functional. Notifications/messages/calendar dedicated APIs are still missing. |
| Admin dashboard | `src/pages/admin/AdminDashboardPage.tsx` | `/admin` | `adminDashboardService` | Functional with computed backend data. RBAC model remains bootstrap-level. |
| Meeting manager | `src/components/MeetingList.tsx` | `/reunions` | `meetingService`, `publicSettingsService` | Functional. Large component; needs future decomposition. |
| Meeting join page | `src/pages/MeetingJoinPage.tsx` | `/join`, `/join/:meetingLink` | `meetingService` | Functional. |
| Simple info pages | `src/App.tsx` inline `SimpleInfoPage` | `/aide`, `/securite`, `/fonctionnalites` | None | Informational placeholders. Need full dynamic pages if product requires them. |

## Static Or Partial Areas

- Notifications center page does not exist yet.
- Messages/conversations page does not exist yet.
- Contacts/friendship pages do not exist yet.
- Calendar page does not exist yet.
- Recordings, moderation, reports, bans, audit logs, storage, integrations, whiteboard, polls are navigation targets but not full modules.
- Admin stats are computed from current users/meetings; reports/bans/recordings are zero until models exist.
