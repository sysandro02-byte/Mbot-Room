# Plan d'implementation MBoteRoom

Date: 2026-07-11

## Phase 1 - Audit et stabilisation

Priorite critique:

- Exiger une session valide pour Socket.IO.
- Verifier cote serveur qu'un utilisateur peut entrer dans une reunion.
- Verifier que la signalisation WebRTC ne sort pas de la reunion courante.
- Hacher les nouveaux mots de passe de reunion et garder une compatibilite lecture avec les anciennes donnees.
- Renforcer les autorisations lobby et demandes media.
- Ajouter une documentation des evenements Socket.IO.
- Maintenir `npm.cmd run lint` et `npm.cmd run build`.
- Integrer Luna IA de facon serveur-side, sans exposer les cles, avec fallback clair si le fournisseur IA est indisponible.

Priorite haute:

- Ajouter CORS strict par variable d'environnement.
- Ajouter Helmet ou headers equivalents.
- Ajouter rate limiting sur auth, join, lobby et Socket.IO.
- Creer des migrations SQL versionnees sous `server/database/migrations` ou `docs/migrations` avant de creer de nouvelles tables.
- Introduire un gestionnaire d'erreurs Express centralise.
- Ajouter une suite de tests minimale backend.

## Phase 2 - Salle de reunion

Priorite haute:

- Modeliser `room_roles`, `room_permissions`, `room_meeting_members`, `room_meeting_bans`.
- Ajouter API participants: liste, role, mute, remove, ban, move to lobby.
- Refaire progressivement l'interface salle: barre haute, zone galerie, barre basse, panneau lateral.
- Raccorder les actions participant au backend.
- Ajouter partage d'ecran robuste avec restrictions par role.

Priorite moyenne:

- Qualite reseau, indicateur de parole, pin participant, vue presentateur.
- Reconnexion Socket.IO/WebRTC et reprise ICE.

## Phase 3 - Collaboration

Priorite haute:

- Chat persistant: `room_messages`, `room_message_reactions`, `room_message_reads`.
- Reactions temps reel et main levee: `room_reactions`.
- Sondages: `room_polls`, `room_poll_options`, `room_poll_answers`.

Priorite moyenne:

- Questions/reponses.
- Notes collaboratives.
- Upload fichiers avec validation MIME, taille et stockage prive.

## Phase 4 - Outils avances

Priorite moyenne:

- Tableau blanc par operations structurees.
- Enregistrement local navigateur avec consentement visible.
- Calendrier, invitations, rappels et export ICS.
- Historique de reunion et notifications.

## Phase 5 - Administration

Priorite moyenne:

- Roles admin verifies cote serveur.
- Tableau de bord, moderation, rapports, logs, statistiques.
- Tables `room_admin_roles`, `room_reports`, `room_bans`, `room_audit_logs`, `room_security_events`, `room_system_settings`.

## Phase 6 - Preparation a l'echelle

Priorite basse a moyenne:

- Configuration STUN/TURN complete par env.
- Abstraction media pour future SFU LiveKit/mediasoup/Janus.
- Observabilite, tests de charge, limites de ressources.
- Interfaces IA sans fausse simulation.
- Integration MBote par couche dediee, sans acces direct aux tables MBote.

## Regle d'execution

Chaque phase doit se terminer par:

- lint;
- build;
- tests disponibles;
- documentation mise a jour;
- commit Git clair;
- liste des limites restantes.
