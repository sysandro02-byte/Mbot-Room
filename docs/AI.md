# Luna IA dans MBoteRoom

Date: 2026-07-11

## Objectif

MBoteRoom integre Luna IA, l'assistante de MBote, dans la salle de reunion. Elle aide a:

- resumer les points fournis par l'utilisateur;
- clarifier une decision;
- proposer les prochaines actions;
- preparer un ordre du jour;
- reformuler une intervention.

## Securite

- La cle IA reste uniquement cote serveur dans `.env`.
- Le frontend appelle seulement `POST /api/ai/luna`.
- L'endpoint exige une session valide.
- L'utilisateur doit etre hote, co-hote ou accepte dans le lobby de la reunion.
- Luna ne pretend pas transcrire l'audio, lire la video ou analyser des fichiers si ces donnees ne sont pas fournies.

## Variables d'environnement

```env
GROQ_API_KEY=
GROQ_MODEL=
GROQ_FALLBACK_MODELS=
GROQ_TIMEOUT_MS=
```

Ces variables sont reprises du projet MBote localement, sans etre versionnees.

## Endpoint

```text
POST /api/ai/luna
```

Payload:

```json
{
  "meetingId": 1,
  "prompt": "Resume les points importants de cette reunion.",
  "tone": "professional"
}
```

Reponse:

```json
{
  "answer": "Texte genere par Luna.",
  "configured": true
}
```

Si le fournisseur IA n'est pas configure ou indisponible, `configured` vaut `false` et l'interface affiche une limite claire.

## Limites connues

- Pas encore de transcription audio automatique.
- Pas encore d'historique persistant des conversations Luna.
- Pas encore de resume final automatique lie aux messages persistants de reunion.
- Pas encore de moderation IA temps reel.
