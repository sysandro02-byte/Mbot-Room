# Realtime Events Map

Date: 2026-07-11

## Server Socket.IO Listeners

| Event | Source | Purpose | Notes |
| --- | --- | --- | --- |
| `meeting:join` | client | Join Socket.IO meeting room and register participant metadata | Uses auth token from socket auth/header where available. |
| `meeting:media-updated` | client | Broadcast participant media state | In-memory participant map. |
| `meeting:chat-message` | client | Relay meeting chat message | Not persisted yet. |
| `meeting:hand-raised` | client | Relay hand-raised state | Not persisted yet. |
| `meeting:offer` | client | Relay WebRTC offer to target socket | Requires target socket id. |
| `meeting:answer` | client | Relay WebRTC answer to target socket | Requires target socket id. |
| `meeting:ice-candidate` | client | Relay ICE candidate to target socket | Requires target socket id. |
| `meeting:leave` | client | Remove participant and notify peers | Also called on disconnect. |
| `disconnect` | socket | Cleanup participant state | Required to avoid stale participants. |

## Server Emits From REST Mutations

| Event | Source route | Payload |
| --- | --- | --- |
| `meeting:created` | `POST /api/meetings` | public meeting |
| `meeting:updated` | `PUT /api/meetings/:meetingId` | public meeting |
| `meeting:cancelled` | `DELETE /api/meetings/:meetingId` | `{ meetingId }` |
| `meeting:started` | `POST /api/meetings/:meetingId/start-notify` | public meeting |

## Frontend Listeners

| File | Events |
| --- | --- |
| `src/hooks/useMeetingMeshWebRTC.ts` | `meeting:participant-joined`, `meeting:participant-left`, `meeting:participant-media-updated`, `meeting:offer`, `meeting:answer`, `meeting:ice-candidate` |
| `src/pages/GuestMeetingPage.tsx` | `meeting:chat-message`, `meeting:hand-raised` |
| `src/pages/dashboard/UserDashboardPage.tsx` | meeting lifecycle events, future `notification:new`, `message:new`, `calendar:event-updated` |
| `src/pages/admin/AdminDashboardPage.tsx` | meeting lifecycle events, future admin events |

## Open Items

- Chat messages are relayed but not persisted.
- Notifications events are anticipated by the dashboards but no persisted notifications module exists.
- Admin-specific events are anticipated but only meeting lifecycle events are currently emitted.
- Socket auth is basic; stronger room-level permission checks should be added before production.
