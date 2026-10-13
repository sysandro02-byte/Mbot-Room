# MBotéRoom — Certification après audit du 12 octobre 2026

Cette liste distingue les preuves automatiques d'une certification sur matériel réel. Une compilation ou un smoke navigateur **ne certifie pas** l'APK sur Android.

## Étapes automatiques avant fusion

1. Vérifier que `npm ci`, `npm audit`, TypeScript, la compilation frontend/backend, l'import des sauvegardes et les tests PostgreSQL/temps réel réussissent dans **MBoteRoom CI**.
2. Vérifier la prévisualisation Vercel et l'absence de régression de navigation Android/web.
3. Après fusion et déploiement, exécuter **MBoteRoom Live Production Smoke** avec frontend Vercel et backend Render. Les scripts ouvrent l'interface `MBOTE_ROOM_SMOKE_APP_URL` (Vercel par défaut).
4. Dans **Actions → MBoteRoom Live Production Smoke → Run workflow**, activer **require_turn_relay** pour exiger la preuve d'une paire ICE relais sélectionnée sur les deux navigateurs. Sans cette option, le test fournit seulement un diagnostic ; un succès de réunion LiveKit ne prouve pas TURN.
5. Inspecter `PRODUCTION_MEDIA_DIAGNOSTICS` : `selectedPairs[].localType === "relay"` et `relaySelected: true` pour hôte et invité. Un nombre de `relayCandidates` positif ne suffit pas à lui seul ; aucune adresse IP n'est journalisée.

## Certification indispensable sur Android physique

Tester l'APK signé sur un vrai Android dans chaque configuration :

| Réseau | Hôte | Participant | Critères |
| --- | --- | --- | --- |
| Wi-Fi → Wi-Fi | Android | PC ou autre Android | Micro et caméra bidirectionnels, reconnexion, réception des notifications |
| 4G/5G → Wi-Fi | Android | PC | Média bidirectionnel, changement réseau, réunion terminée |
| Wi-Fi → 4G/5G | PC | Android | Permissions, connexion/rotation, rétablissement après coupure |
| 4G/5G → 4G/5G | Android | Android | Média bidirectionnel et preuve TURN si le relais est forcé |

Pour chaque cas, enregistrer le modèle et la version Android, les réseaux réellement utilisés, le résultat ICE sélectionné (relay ou non), les autorisations et l'heure du test. Ne pas confondre une simulation Chromium avec un test matériel.

## Fonctionnalités encore non certifiées

- Google Calendar : activer OAuth et configurer les URI de redirection côté Google Cloud/Render ; faire un événement aller-retour.
- Enregistrement serveur : configurer LiveKit Egress et le stockage serveur, déclencher un enregistrement et contrôler le fichier privé terminé.
- Push APK fermé : prouver la réception native sur téléphone réel ; Web Push seul n'établit pas FCM natif.
- QR PC : la page Paramètres fournit un lien de connexion. L'appairage sécurisé par QR n'existe pas encore, ne pas l'annoncer.
- Export local : le fichier contient **uniquement** des préférences ; la restauration valide l'appartenance au même compte. Ne pas l'appeler sauvegarde complète des messages et fichiers.
- Géolocalisation : seules les sessions peuvent être listées/révoquées, sans géolocalisation.
- Maquettes : comparer toutes les pages de l'APK aux visuels originaux, téléphone en portrait/paysage, vérifier les zones système, la navigation et les tailles de police.
- Performance : mesurer LCP/INP et le poids transféré sur téléphone réseau limité avant d'annoncer un gain réel.

Aucun de ces contrôles ne demande de journaliser une clé API, un secret, des données de comptes réels ou des adresses IP personnelles.
