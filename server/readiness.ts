import { getEmailDeliveryStatus } from './emailDelivery.js';
export type RuntimeReadiness = {
  database: {
    type: string;
    persistent: boolean;
  };
  integrations: {
    groq: boolean;
    transcription: boolean;
    email: boolean;
    emailProvider: string;
    mailRelay: boolean;
    brevo: boolean;
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
  const emailDelivery = getEmailDeliveryStatus();
  const mboteAuth = has(process.env.MBOTE_AUTH_BASE_URL) && has(process.env.MBOTE_AUTH_CLIENT_ID);
  const livekit = has(process.env.LIVEKIT_URL) && has(process.env.LIVEKIT_API_KEY) && has(process.env.LIVEKIT_API_SECRET);
  const dynamicTurn = has(process.env.TURN_URLS) && has(process.env.TURN_SHARED_SECRET);
  const staticTurn = has(process.env.MBOTEROOM_TURN_URL)
    && has(process.env.MBOTEROOM_TURN_USERNAME)
    && has(process.env.MBOTEROOM_TURN_CREDENTIAL);
  const turn = dynamicTurn || staticTurn;
  const egressEnabled = String(process.env.LIVEKIT_EGRESS_ENABLED || '').trim().toLowerCase() === 'true';
  const defaultStorage = String(process.env.LIVEKIT_EGRESS_USE_SERVER_DEFAULT_STORAGE || '').trim().toLowerCase() === 'true';
  const s3Storage = has(process.env.LIVEKIT_EGRESS_S3_BUCKET)
    && has(process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY)
    && has(process.env.LIVEKIT_EGRESS_S3_SECRET_KEY)
    && (has(process.env.LIVEKIT_EGRESS_S3_ENDPOINT) || has(process.env.LIVEKIT_EGRESS_S3_REGION));
  const serverRecording = livekit && egressEnabled && (defaultStorage || s3Storage);
  const requireLivekit = String(process.env.MBOTE_ROOM_REQUIRE_LIVEKIT || '').trim().toLowerCase() === 'true';
  const requireServerRecording = String(process.env.MBOTE_ROOM_REQUIRE_SERVER_RECORDING || '').trim().toLowerCase() === 'true';

  const blockers: string[] = [];
  if (!persistentDatabase) blockers.push('persistent_database');
  if (!groq) blockers.push('luna_groq');
  if (!emailDelivery.configured) blockers.push('email_delivery');
  if (!livekit && !turn) blockers.push('resilient_media');
  if (requireLivekit && !livekit) blockers.push('livekit');
  if (requireServerRecording && !serverRecording) blockers.push('server_recording');

  return {
    database: {
      type: databaseType,
      persistent: persistentDatabase,
    },
    integrations: {
      groq,
      transcription,
      email: emailDelivery.configured,
      emailProvider: emailDelivery.provider,
      mailRelay: emailDelivery.relay,
      brevo: emailDelivery.brevo,
      resend: emailDelivery.resend,
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
