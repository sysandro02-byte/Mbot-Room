# Socket.IO MBoteRoom

Date: 2026-07-11

## Authentification

Le client doit fournir le token de session dans `socket.auth.token` avant la connexion.

```ts
socket.auth = { token };
socket.connect();
```

Le serveur refuse la connexion Socket.IO si la session est absente, invalide ou expiree.

## Regles serveur

- L'identite du participant vient toujours de la session serveur.
- Les champs `userId`, `name` et `avatar` envoyes par le client dans `meeting:join` sont ignores/remplaces.
- Un utilisateur peut entrer dans la salle temps reel seulement s'il est hote, co-hote ou accepte dans le lobby.
- Les evenements media et WebRTC sont acceptes seulement pour la reunion courante du socket.
- Les offres, reponses et candidats ICE sont relayes seulement si l'emetteur et la cible sont deja presents dans la meme reunion.

## Evenements client vers serveur

### `meeting:join`

Payload:

```ts
{
  meetingId: number | string;
  media?: {
    audio?: boolean;
    video?: boolean;
    screen?: boolean;
  };
}
```

Callback:

```ts
{
  ok: boolean;
  error?: string;
  participants?: Array<{
    socketId: string;
    userId: string;
    name: string;
    avatar: string;
    media: {
      audio: boolean;
      video: boolean;
      screen: boolean;
    };
  }>;
}
```

### `meeting:leave`

Le serveur retire le socket de la reunion courante et emet `meeting:participant-left`.

### `meeting:media-updated`

Payload:

```ts
{
  meetingId: number | string;
  media: {
    audio?: boolean;
    video?: boolean;
    screen?: boolean;
  };
}
```

### `meeting:offer`

Payload:

```ts
{
  meetingId: number | string;
  targetSocketId: string;
  offer: RTCSessionDescriptionInit;
}
```

### `meeting:answer`

Payload:

```ts
{
  meetingId: number | string;
  targetSocketId: string;
  answer: RTCSessionDescriptionInit;
}
```

### `meeting:ice-candidate`

Payload:

```ts
{
  meetingId: number | string;
  targetSocketId: string;
  candidate: RTCIceCandidateInit;
}
```

## Evenements serveur vers client

- `meeting:participant-joined`
- `meeting:participant-left`
- `meeting:participant-media-updated`
- `meeting:offer`
- `meeting:answer`
- `meeting:ice-candidate`

## Limites connues

- Pas encore de rate limiting Socket.IO.
- Pas encore de schema Zod partage entre client et serveur.
- Pas encore de journalisation structuree des erreurs temps reel.
- Pas encore de reconnexion WebRTC avancee ni relance ICE.
