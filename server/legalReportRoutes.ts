import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  normalizeText,
  query,
  requireAdmin,
  requireDatabase,
  sendApiError,
} from './core.js';
import { sendTransactionalEmail } from './emailDelivery.js';
import { createNotificationAndPush } from './pushService.js';

const defaultTerms = {
  key: 'terms',
  title: 'Conditions d’utilisation MBotéRoom',
  body: 'Bienvenue sur MBotéRoom. Utilisez l’application de manière licite, respectueuse et conforme aux règles de sécurité.',
  version: '2026-09-24',
};

const mapLegal = (row: any) => ({
  key: String(row?.key || defaultTerms.key),
  title: String(row?.title || defaultTerms.title),
  body: String(row?.body || defaultTerms.body),
  version: String(row?.version || defaultTerms.version),
  updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
});

const loadTerms = async () => {
  const result = await query("SELECT key,title,body,version,updated_at FROM room_legal_documents WHERE key='terms' LIMIT 1");
  return mapLegal(result.rows[0] || defaultTerms);
};

const reportPayload = (row: any) => ({
  id: String(row.id),
  reporterUserId: row.reporter_user_id ? Number(row.reporter_user_id) : null,
  reporterName: String(row.reporter_name || ''),
  reporterEmail: String(row.reporter_email || ''),
  type: row.report_type === 'meeting' ? 'meeting' : 'bug',
  meetingId: row.meeting_id ? Number(row.meeting_id) : null,
  meetingTitle: String(row.meeting_title || ''),
  title: String(row.title || ''),
  description: String(row.description || ''),
  pageUrl: String(row.page_url || ''),
  status: String(row.status || 'open'),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at || row.created_at).toISOString(),
});

export const registerLegalAndReportRoutes = (app: express.Express, io: Server) => {
  app.get('/api/public/legal/terms', requireDatabase, async (_request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.json(await loadTerms());
    } catch (error) { next(error); }
  });

  app.post('/api/reports', requireDatabase, authenticateToken, async (request: AuthedRequest, response, next) => {
    try {
      const type = request.body?.type === 'meeting' ? 'meeting' : request.body?.type === 'bug' ? 'bug' : '';
      const title = normalizeText(request.body?.title).slice(0, 180);
      const description = normalizeText(request.body?.description).slice(0, 5000);
      const pageUrl = String(request.body?.pageUrl || '').trim().slice(0, 1000);
      const meetingId = Number(request.body?.meetingId || 0) || null;
      if (!type || !title || description.length < 8) {
        return sendApiError(response, 400, 'REPORT_INVALID', 'Précisez le type, le titre et une description du signalement.');
      }
      if (type === 'meeting' && !meetingId) {
        return sendApiError(response, 400, 'REPORT_MEETING_REQUIRED', 'Sélectionnez la réunion à signaler.');
      }
      let meetingTitle = '';
      if (meetingId) {
        const meeting = await query('SELECT id,title FROM room_meetings WHERE id=$1 LIMIT 1', [meetingId]);
        if (!meeting.rows[0]) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
        meetingTitle = String(meeting.rows[0].title || '');
      }

      const id = createId();
      const inserted = await query(
        `INSERT INTO room_reports (id,reporter_user_id,report_type,meeting_id,title,description,page_url,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         RETURNING *`,
        [id, request.user!.id, type, meetingId, title, description, pageUrl, JSON.stringify({
          userAgent: String(request.headers['user-agent'] || '').slice(0, 500),
          reporterRole: request.user!.role,
        })],
      );

      const admins = await query(
        "SELECT id,email,name FROM room_users WHERE role='admin' AND COALESCE(is_suspended,false)=false AND COALESCE(account_status,'active')<>'banned'",
      );
      const subject = type === 'meeting' ? `[MBotéRoom] Réunion signalée · ${meetingTitle || meetingId}` : `[MBotéRoom] Bug signalé · ${title}`;
      const textBody = [
        `Signalement #${id}`,
        `Type : ${type === 'meeting' ? 'Réunion' : 'Bug'}`,
        `Utilisateur : ${request.user!.name} <${request.user!.email}>`,
        meetingId ? `Réunion : ${meetingTitle} (#${meetingId})` : '',
        `Titre : ${title}`,
        `Description : ${description}`,
        pageUrl ? `Page : ${pageUrl}` : '',
      ].filter(Boolean).join('\n');

      const recipients = new Set<string>(['contacts@loukatech.com']);
      admins.rows.forEach((row) => {
        const email = String(row.email || '').trim();
        if (email) recipients.add(email);
      });
      await Promise.all([...recipients].map((to) => sendTransactionalEmail({
        to,
        subject,
        text: textBody,
      }).catch(() => false)));

      for (const admin of admins.rows) {
        const notification = await createNotificationAndPush(Number(admin.id), {
          type: 'USER_REPORT',
          title: type === 'meeting' ? 'Réunion signalée' : 'Nouveau bug signalé',
          body: `${request.user!.name} · ${title}`,
          url: '/admin#admin-reports',
          tag: `report-${id}`,
          data: { reportId: id, reportType: type, meetingId },
        }).catch(() => null);
        if (notification) io.to(`user:${Number(admin.id)}`).emit('notification:new', notification);
      }

      const row = inserted.rows[0];
      response.status(201).json(reportPayload({
        ...row,
        reporter_name: request.user!.name,
        reporter_email: request.user!.email,
        meeting_title: meetingTitle,
      }));
    } catch (error) { next(error); }
  });

  const adminApi = [requireDatabase, authenticateToken, requireAdmin] as const;

  app.get('/api/admin/legal/terms', ...adminApi, async (_request, response, next) => {
    try { response.json(await loadTerms()); } catch (error) { next(error); }
  });

  app.put('/api/admin/legal/terms', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const title = normalizeText(request.body?.title).slice(0, 180);
      const body = String(request.body?.body || '').trim().slice(0, 30000);
      if (!title || body.length < 80) return sendApiError(response, 400, 'TERMS_INVALID', 'Les conditions doivent contenir un titre et un texte suffisamment détaillé.');
      const version = new Date().toISOString().slice(0, 10) + '-' + Date.now().toString(36);
      const result = await query(
        `INSERT INTO room_legal_documents (key,title,body,version,updated_at)
         VALUES ('terms',$1,$2,$3,now())
         ON CONFLICT (key) DO UPDATE SET title=excluded.title,body=excluded.body,version=excluded.version,updated_at=now()
         RETURNING *`,
        [title, body, version],
      );
      io.emit('legal:terms-updated', { version });
      response.json(mapLegal(result.rows[0]));
    } catch (error) { next(error); }
  });

  app.get('/api/admin/reports', ...adminApi, async (request, response, next) => {
    try {
      const status = String(request.query.status || '').trim();
      const params: unknown[] = [];
      let where = '';
      if (['open','reviewing','resolved','dismissed'].includes(status)) {
        params.push(status);
        where = 'WHERE r.status=$1';
      }
      const result = await query(
        `SELECT r.*,u.name AS reporter_name,u.email AS reporter_email,m.title AS meeting_title
           FROM room_reports r
           LEFT JOIN room_users u ON u.id=r.reporter_user_id
           LEFT JOIN room_meetings m ON m.id=r.meeting_id
           ${where}
          ORDER BY r.created_at DESC
          LIMIT 250`,
        params,
      );
      response.json(result.rows.map(reportPayload));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/reports/:reportId', ...adminApi, async (request, response, next) => {
    try {
      const status = String(request.body?.status || '');
      if (!['open','reviewing','resolved','dismissed'].includes(status)) {
        return sendApiError(response, 400, 'REPORT_STATUS_INVALID', 'État de signalement invalide.');
      }
      const result = await query(
        `UPDATE room_reports SET status=$2,updated_at=now() WHERE id=$1 RETURNING *`,
        [request.params.reportId, status],
      );
      if (!result.rows[0]) return sendApiError(response, 404, 'REPORT_NOT_FOUND', 'Signalement introuvable.');
      response.json(reportPayload(result.rows[0]));
    } catch (error) { next(error); }
  });
};
