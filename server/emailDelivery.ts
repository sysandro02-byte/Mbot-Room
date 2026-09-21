type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const read = (value: unknown) => String(value || '').trim();

export const getEmailDeliveryStatus = () => {
  const relay = Boolean(read(process.env.MBOTE_MAIL_RELAY_URL) && read(process.env.MBOTE_ROOM_MAIL_SECRET));
  const brevo = Boolean(read(process.env.BREVO_API_KEY));
  const resend = Boolean(read(process.env.RESEND_API_KEY) && read(process.env.MEETING_INVITE_FROM));
  return {
    configured: relay || brevo || resend,
    relay,
    brevo,
    resend,
    provider: relay ? 'mbote-brevo-relay' : brevo ? 'brevo' : resend ? 'resend' : 'none',
  };
};

const sendViaRelay = async (message: TransactionalEmail) => {
  const relayUrl = read(process.env.MBOTE_MAIL_RELAY_URL);
  const secret = read(process.env.MBOTE_ROOM_MAIL_SECRET);
  if (!relayUrl || !secret) return null;

  const response = await fetch(relayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-mbote-room-mail-secret': secret,
    },
    body: JSON.stringify({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html || '',
    }),
    signal: AbortSignal.timeout(Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)),
  }).catch(() => null);

  if (!response?.ok) return false;
  return true;
};

const sendViaBrevo = async (message: TransactionalEmail) => {
  const apiKey = read(process.env.BREVO_API_KEY);
  if (!apiKey) return null;

  const senderEmail = read(process.env.BREVO_SENDER_EMAIL) || 'contacts@loukatech.com';
  const senderName = read(process.env.BREVO_SENDER_NAME) || 'MBotéRoom';
  const replyTo = read(process.env.EMAIL_REPLY_TO);
  const apiUrl = read(process.env.BREVO_API_URL) || 'https://api.brevo.com/v3/smtp/email';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: message.to }],
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html || undefined,
    }),
    signal: AbortSignal.timeout(Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)),
  }).catch(() => null);

  if (!response?.ok) return false;
  return true;
};

const sendViaResend = async (message: TransactionalEmail) => {
  const apiKey = read(process.env.RESEND_API_KEY);
  const from = read(process.env.MEETING_INVITE_FROM);
  if (!apiKey || !from) return null;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
    signal: AbortSignal.timeout(Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)),
  }).catch(() => null);

  if (!response?.ok) return false;
  return true;
};

export const sendTransactionalEmail = async (message: TransactionalEmail) => {
  const relayResult = await sendViaRelay(message);
  if (relayResult === true) return true;

  const brevoResult = await sendViaBrevo(message);
  if (brevoResult === true) return true;

  const resendResult = await sendViaResend(message);
  if (resendResult === true) return true;

  return false;
};
