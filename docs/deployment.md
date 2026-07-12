# Déploiement MBotéRoom

## Architecture

- Frontend React/Vite : Vercel.
- Backend Express + Socket.IO : Render.
- Base de données : PostgreSQL Render via `DATABASE_URL`.

## Variables Vercel

Configurer dans le dashboard Vercel :

- `VITE_API_URL=https://<service-render>.onrender.com`
- `VITE_SOCKET_URL=https://<service-render>.onrender.com`
- `VITE_TURN_URLS` si un serveur TURN est disponible.
- `VITE_TURN_USERNAME` si le serveur TURN l'exige.
- `VITE_TURN_CREDENTIAL` si le serveur TURN l'exige.

## Variables Render

Le fichier `render.yaml` crée le service API et la base PostgreSQL. Les valeurs marquées `sync: false` doivent être renseignées dans Render :

- `ADMIN_EMAILS`
- `MBOTE_AUTH_BASE_URL`
- `MBOTE_AUTH_CLIENT_ID`
- `MBOTE_AUTH_CLIENT_SECRET`
- `MBOTE_AUTH_PROFILE_URL`
- `MBOTE_AUTH_REDIRECT_URI`
- `GROQ_API_KEY`

Ne pas copier de tokens Vercel ou Render dans le dépôt.
