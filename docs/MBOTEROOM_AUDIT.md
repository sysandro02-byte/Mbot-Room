# Audit MBoteRoom

Date: 2026-07-11

## Synthese

MBoteRoom est une application React/Vite avec un serveur Express monolithique dans `server.ts`. Elle couvre deja les flux essentiels: compte utilisateur, session bearer, creation et gestion de reunions, acces invite, salle d'attente, presence temps reel Socket.IO et WebRTC mesh.

La base est Supabase PostgreSQL via `pg`. Les tables applicatives existantes respectent le prefixe `room_`: `room_users`, `room_sessions`, `room_meetings`, `room_lobby`, `room_media_requests`.

Le projet est fonctionnel mais la Phase 1 doit prioriser la securite serveur, la validation des entrees, les autorisations, la stabilisation Socket.IO/WebRTC et les migrations versionnees avant d'ajouter chat, sondages, tableau blanc ou administration.

## Architecture constatee

- Frontend: `src/App.tsx`, `src/pages`, `src/components`, `src/services`, `src/hooks`, `src/lib`.
- Backend: `server.ts` regroupe config, migrations, persistence, routes, auth, sockets et static serving.
- Routes React: `/login`, `/app`, `/join`, `/join/:meetingLink`.
- API: routes auth, meetings, lobby, media requests, health et actus events.
- Socket.IO: `meeting:join`, `meeting:leave`, `meeting:media-updated`, `meeting:offer`, `meeting:answer`, `meeting:ice-candidate`.
- WebRTC: `src/hooks/useMeetingMeshWebRTC.ts` gere les pairs mesh et `src/lib/webrtc.ts` fournit la config ICE.

## Risques critiques

1. Les sockets ne validaient pas la session au moment de l'audit. Un client pouvait envoyer des payloads de presence ou de signalisation sans verification serveur stricte.
2. `meeting:join` faisait confiance au payload pour l'identite du participant. Risque d'usurpation utilisateur/reunion.
3. La signalisation WebRTC relayait des payloads vers un socket cible sans verifier que l'emetteur et la cible etaient dans la meme reunion.
4. Les mots de passe de reunion etaient conserves dans les settings de reunion. Les nouvelles reunions doivent stocker un hash, avec compatibilite lecture pour les anciennes donnees.
5. Les endpoints media/lobby avaient des controles incomplets: lecture lobby trop large, demandes media possibles sans verification suffisante de role et de cible.
6. La persistence Postgres reecrit les tables `room_*` depuis l'etat memoire. C'est acceptable en mono-instance locale, mais risque de concurrence et d'ecrasement si plusieurs serveurs tournent.

## Risques haute priorite

- CORS actuellement permissif. Il faut une liste d'origines autorisees par variable d'environnement.
- Pas de rate limiting sur auth, join et Socket.IO.
- Pas de Helmet ni headers de securite complets.
- Pas de gestion d'erreurs centralisee pour les routes async.
- Les roles sont reduits a hote/co-hote dans `room_meetings`; pas encore de modele `room_roles`, `room_permissions`, `room_meeting_members`.
- Pas de migrations SQL versionnees dans le depot; les migrations sont executees inline dans `server.ts`.
- Les commandes sensibles cote frontend ne sont pas toutes raccordees a des endpoints serveur reels.

## Risques moyenne priorite

- WebRTC mesh simple: pas de TURN serveur configure par defaut, pas de relance ICE, pas de mesure qualite reseau.
- Nettoyage des flux locaux present, mais la gestion du changement de piste utilise encore une renegociation complete plutot qu'un `replaceTrack` cible.
- Chat, sondages, reactions et plusieurs actions participants sont actuellement surtout locaux au frontend.
- Pas de tests automatises declares dans `package.json`.
- Documentation technique incomplete avant cet audit.

## Risques basse priorite

- Structure backend monolithique. Une decomposition progressive en controllers/services/repositories sera necessaire.
- Certains textes affichent des caracteres mal encodes dans les sources existantes.
- Build Vite signale un chunk superieur a 500 kB; code splitting a prevoir.

## Verification des contraintes base de donnees

- Tables detectees/creees: `room_users`, `room_sessions`, `room_meetings`, `room_lobby`, `room_media_requests`.
- Aucune table non prefixee `room_` ne doit etre creee pour MBoteRoom.
- Les requetes SQL existantes utilisent des parametres pour les valeurs dynamiques.
- Les secrets sont dans `.env`, ignore par Git.

## Conclusion Phase 1

Avant toute extension type Zoom/Meet, la priorite est de fermer les failles serveur existantes: authentification Socket.IO, verification d'appartenance a la reunion, validation stricte des payloads, hashing des mots de passe de reunion, durcissement CORS/rate limit, migrations versionnees et tests.
