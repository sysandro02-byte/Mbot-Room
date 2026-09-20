export type RuntimeReadiness = {
  database: {
    type: string;
    persistent: boolean;
  };
  integrations: {
    groq: boolean;
    transcription: boolean;
    resend: boolean;
    mboteAuth: boolean;
    livekit: boolean;
    turn: boolean;
    serverRecording: boolean;
  };
  testReady: boolean;
  productionReady: boolean;
  blockers: string[];
};

const has = (value: unknown) => Boolean(String(value || '').trim());

export const getRuntimeReadiness = (databaseType: string): RuntimeReadiness => {
  const persistentDatabase = databaseType === 'postgres';
  const groq = has(process.env.GROQ_API_KEY);
  const transcription = has(process.env.GROQ_TRANSCRIPTION_API_KEY) || groq;
  const resend = has(process.env.RESEND_API_KEY) && has(process.env.MEETING_INVITE_FROM);
  const mboteAuth = has(process.env.MBOTE_AUTH_BASE_URL) && has(process.env.MBOTE_AUTH_CLIENT_ID);
  const livekit = has(process.env.LIVEKIT_URL) && has(process.env.LIVEKIT_API_KEY) && has(process.env.LIVEKIT_API_SECRET);
  const turn = has(process.env.TURN_URLS) && has(process.env.TURN_SHARED_SECRET);
  const egressEnabled = String(process.env.LIVEKIT_EGRESS_ENABLED || '').trim().toLowerCase() === 'true';
  const defaultStorage = String(process.env.LIVEKIT_EGRESS_USE_SERVER_DEFAULT_STORAGE || '').trim().toLowerCase() === 'true';
  const s3Storage = has(process.env.LIVEKIT_EGRESS_S3_BUCKET)
    && has(process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY)
    && has(process.env.LIVEKIT_EGRESS_S3_SECRET_KEY)
    && (has(process.env.LIVEKIT_EGRESS_S3_ENDPOINT) || has(process.env.LIVEKIT_EGRESS_S3_REGION));
  const serverRecording = livekit && egressEnabled && (defaultStorage || s3Storage);

  const blockers: string[] = [];
  if (!persistentDatabase) blockers.push('persistent_database');
  if (!groq) blockers.push('luna_groq');
  if (!resend) blockers.push('email_resend');
  if (!livekit && !turn) blockers.push('resilient_media');

  return {
    database: {
      type: databaseType,
      persistent: persistentDatabase,
    },
    integrations: {
      groq,
      transcription,
      resend,
      mboteAuth,
      livekit,
      turn,
      serverRecording,
    },
    testReady: persistentDatabase,
    productionReady: blockers.length === 0,
    blockers,
  };
};
