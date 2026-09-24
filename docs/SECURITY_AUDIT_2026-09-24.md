# Audit sécurité MBotéRoom — 24 septembre 2026

## Périmètre

Audit ciblé du frontend React, de l’API Express, de Socket.IO/WebRTC, des rôles de réunion, de la salle d’attente et du packaging Android.

## Correctifs appliqués

- Le rôle hôte de secours est déterminé côté serveur, jamais depuis une valeur fournie par le client.
- Le co-hôte est prioritaire lors d’un départ de l’hôte principal ; sinon un participant connecté est promu afin de maintenir la réunion.
- Au retour de l’hôte principal, le rôle temporaire est retiré et le rôle d’hôte principal est restauré.
- Les permissions de modération, d’enregistrement et de transcription reconnaissent l’hôte temporaire.
- Les événements Socket.IO entrants sont limités par fréquence, avec des seuils adaptés à la signalisation WebRTC.
- Les routes de jointure et de salle d’attente ont des limites de requêtes dédiées.
- Le serveur refuse explicitement l’accès HTTP à son bundle `server.js` et aux source maps.
- Les builds frontend et serveur de production n’exposent pas de source maps.
- Le frontend conserve CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy et CORS par liste d’origines.
- Les sessions navigateur utilisent des cookies HttpOnly et SameSite ; les secrets TURN/Groq/LiveKit restent côté serveur.
- L’APK Android interdit le trafic HTTP clair, désactive le débogage WebView et n’accorde caméra/micro qu’au domaine MBotéRoom officiel.

## Limite volontaire

Aucune application web ne peut empêcher un utilisateur de voir le HTML/CSS/JavaScript qui doit être envoyé à son navigateur. La protection correcte consiste à ne jamais livrer les secrets ni les décisions d’autorisation au client. MBotéRoom applique cette séparation côté serveur ; l’APK désactive en plus le débogage WebView.
