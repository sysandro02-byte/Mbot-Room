# Audit sécurité MBotéRoom — 24 septembre 2026

## Contrôles et corrections appliqués

- Hôte temporaire géré côté serveur : priorité au co-hôte, puis à un participant connecté ; restitution automatique au retour de l’hôte principal.
- Permissions de modération, enregistrement et transcription alignées avec l’hôte actif.
- Salle d’attente : notification temps réel visible par l’hôte et le co-hôte.
- Rôles de membres normalisés côté base afin d’éviter le rôle invalide des comptes invités.
- API protégée par limites de fréquence dédiées ; limitation supplémentaire des événements Socket.IO.
- CORS par origine autorisée, CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy et isolation des ressources.
- Le bundle serveur et les source maps ne sont pas servis publiquement ; les builds de production sont minifiés sans source maps serveur.
- Les secrets et décisions d’autorisation restent côté serveur.
- Android : HTTPS obligatoire, WebView durcie, débogage WebView désactivé et permissions caméra/micro limitées au domaine MBotéRoom.

## Limite de sécurité normale du Web

Le HTML, le CSS et le JavaScript nécessaires à une application web doivent être envoyés au navigateur et ne peuvent donc pas être rendus totalement invisibles aux outils de développement. La protection repose sur l’absence de secrets côté client, la validation côté serveur, l’authentification, l’autorisation, la limitation des abus et la réduction de l’information exposée.
