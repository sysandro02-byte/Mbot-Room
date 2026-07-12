# Lot 2 - Authentification, sessions et RBAC

Date : 2026-07-12

## Changements appliques

- L'utilisateur public renvoye par l'API expose maintenant un `role` stable : `admin`, `user` ou `guest`.
- L'utilisateur public renvoye par l'API expose aussi une liste `permissions`.
- Les administrateurs conservent les permissions existantes du tableau de bord admin.
- La detection admin cote serveur reste compatible avec :
  - l'utilisateur d'id `1` ;
  - les emails listes dans `ADMIN_EMAILS`.
- La creation de session respecte maintenant `rememberMe` :
  - `rememberMe: true` : session serveur de 30 jours ;
  - `rememberMe: false` : session serveur de 12 heures.
- Le frontend applique maintenant le meme comportement :
  - session persistante dans `localStorage` si l'utilisateur coche "Se souvenir de moi" ;
  - session de navigation dans `sessionStorage` sinon ;
  - les sessions invitees utilisent `sessionStorage`.
- La route `/admin` est protegee cote React par une garde admin dediee.
- Les erreurs auth/admin exposent maintenant un format commun `{ error, code }` sur les flux critiques.
- Les routes HTTP metier `meetings`, `lobby`, `media-requests` et `Luna IA` utilisent aussi le format `{ error, code }`.
- Les refus Socket.IO exposent maintenant `{ ok: false, error, code }`, et les erreurs de handshake publient `error.data.code`.
- Le bouton Google de la page de connexion est remplace par un bouton d'authentification MBote configurable.
- Le backend expose `/api/auth/mbote/start` et `/api/auth/mbote/callback` pour un flux OAuth MBote.
- Le backend expose `/api/auth/forgot-password` et `/api/auth/reset-password`.
- Le formulaire d'inscription collecte maintenant telephone, organisation et fonction.
- Le serveur accepte `MBOTE_ROOM_DATA_DIR` pour isoler les donnees en test sans toucher `data/mbote-room-db.json`.
- Le serveur accepte `MBOTE_ROOM_DISABLE_POSTGRES=1` pour forcer les tests en stockage JSON local.
- Un test d'integration auth/admin a ete ajoute via `npm.cmd run test:auth-admin`.
- Un test d'integration realtime a ete ajoute via `npm.cmd run test:realtime`.

## Fichiers touches

- `server.ts`
- `src/services/authService.ts`
- `src/App.tsx`
- `src/pages/Login.tsx`
- `src/pages/Login.css`
- `package.json`
- `scripts/test-auth-admin.mjs`
- `scripts/test-realtime-errors.mjs`

## Validation

- `npm.cmd run lint` : OK.
- `npm.cmd run build` : OK.
- `npm.cmd run test:auth-admin` : OK.
- `npm.cmd run test:realtime` : OK.

## Reste a faire

- Remplacer progressivement les messages API historiques mal encodes hors auth/admin.
- Etendre le format d'erreur API commun aux erreurs futures : `{ error, code, details? }`.
- Configurer cote environnement :
  - `MBOTE_AUTH_BASE_URL`
  - `MBOTE_AUTH_CLIENT_ID`
  - `MBOTE_AUTH_CLIENT_SECRET` si le client MBote l'exige
  - `MBOTE_AUTH_PROFILE_URL` si le profil n'est pas expose sur `/api/auth/me`
- Ajouter des tests automatises complementaires pour :
  - expiration reelle de session courte ;
  - profil `/api/auth/me` avec `role` et `permissions` ;
  - erreurs Socket.IO `meeting:join`, WebRTC relay et chat.
- Durcir la production avec un stockage par cookies HTTP-only si le backend cible le permet.
