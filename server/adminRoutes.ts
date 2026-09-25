import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  adminPermissions,
  authenticateToken,
  createId,
  createToken,
  hashToken,
  mapMeeting,
  normalizeEmail,
  normalizeText,
  publicMeeting,
  query,
  requireAdmin,
  requireDatabase,
  sendApiError,
} from './core.js';
import { getPlatformSettings, updatePlatformSettings } from './platformSettings.js';
import { sendPushToUsers } from './pushService.js';


type AdminAudienceFilters = {
  country?: string;
  city?: string;
  role?: 'user' | 'admin' | 'all';
  accountStatus?: 'active' | 'quarantined' | 'banned' | 'all';
  organization?: string;
  jobTitle?: string;
  userIds?: number[];
};

const normalizeAudienceFilters = (value: any): AdminAudienceFilters => {
  const role = ['user','admin','all'].includes(String(value?.role))
    ? String(value.role) as AdminAudienceFilters['role']
    : 'user';
  const accountStatus = ['active','quarantined','banned','all'].includes(String(value?.accountStatus))
    ? String(value.accountStatus) as AdminAudienceFilters['accountStatus']
    : 'active';
  const rawUserIds: number[] = Array.isArray(value?.userIds)
    ? value.userIds
        .map((item: unknown) => Number(item))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0)
    : [];
  const userIds: number[] = [...new Set<number>(rawUserIds)].slice(0,5000);
  return {
    country: normalizeText(value?.country).slice(0,120),
    city: normalizeText(value?.city).slice(0,120),
    role,
    accountStatus,
    organization: normalizeText(value?.organization).slice(0,120),
    jobTitle: normalizeText(value?.jobTitle).slice(0,120),
    userIds,
  };
};

const buildAudienceQuery = (filters: AdminAudienceFilters) => {
  const clauses = ['u.is_guest=false'];
  const params: any[] = [];
  const bind = (sqlPrefix: string, value: unknown, suffix = '') => {
    params.push(value);
    clauses.push(sqlPrefix + '$' + params.length + suffix);
  };
  if (filters.role && filters.role !== 'all') bind('u.role=', filters.role);
  if (filters.accountStatus && filters.accountStatus !== 'all') bind("COALESCE(u.account_status,'active')=", filters.accountStatus);
  if (filters.country) bind("lower(COALESCE(u.country,''))=lower(", filters.country, ')');
  if (filters.city) bind("lower(COALESCE(u.city,''))=lower(", filters.city, ')');
  if (filters.organization) bind("lower(COALESCE(u.organization,'')) LIKE lower(", '%' + filters.organization + '%', ')');
  if (filters.jobTitle) bind("lower(COALESCE(u.job_title,'')) LIKE lower(", '%' + filters.jobTitle + '%', ')');
  if (filters.userIds?.length) bind('u.id = ANY(', filters.userIds, '::int[])');
  return { where: clauses.join(' AND '), params };
};

const rowToBroadcast = (row: any) => ({
  id: String(row.id),
  title: String(row.title || ''),
  body: String(row.body || ''),
  actionPath: String(row.action_path || '/app/notifications'),
  audience: row.audience && typeof row.audience === 'object' ? row.audience : {},
  recipientCount: Number(row.recipient_count || 0),
  pushSent: Number(row.push_sent || 0),
  pushFailed: Number(row.push_failed || 0),
  aiAssisted: Boolean(row.ai_assisted),
  createdAt: new Date(row.created_at).toISOString(),
});

const parseGroqJson = (content: string) => {
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(content.slice(first,last+1)); } catch { return null; }
};

const callAdminGroq = async (system: string, prompt: string) => {
  const key = String(process.env.GROQ_API_KEY || '').trim();
  if (!key) return null;
  const models = String(process.env.GROQ_MODEL || 'openai/gpt-oss-120b,openai/gpt-oss-20b')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const model of models) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.25,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(Math.max(8000,Number(process.env.GROQ_TIMEOUT_MS || 30000))),
      });
      if (!response.ok) continue;
      const data: any = await response.json().catch(() => null);
      const responseContent = String(data?.choices?.[0]?.message?.content || '').trim();
      if (responseContent) return { content: responseContent, model };
    } catch {
      // Continue with the next configured model.
    }
  }
  return null;
};

const rowToTip = (row: any) => ({
  id: String(row.id),
  title: String(row.title || ''),
  body: String(row.body || ''),
  actionLabel: String(row.action_label || ''),
  actionPath: String(row.action_path || ''),
  isActive: Boolean(row.is_active),
  startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : undefined,
  endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : undefined,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const rowToSlide = (row: any) => ({
  id: String(row.id),
  title: String(row.title || ''),
  body: String(row.body || ''),
  imageUrl: String(row.image_url || ''),
  isActive: Boolean(row.is_active),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const rowToHomeSlide = (row: any) => ({
  slot: Number(row.slot),
  title: String(row.title || ''),
  body: String(row.body || ''),
  imageUrl: String(row.image_url || ''),
  actionLabel: String(row.action_label || ''),
  actionPath: String(row.action_path || ''),
  isActive: Boolean(row.is_active),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const rowToLoginBranding = (row: any) => ({
  wordmarkUrl: String(row?.wordmark_url || '/icons/mboteroom-wordmark.png'),
  illustrationUrl: String(row?.illustration_url || '/images/meeting-black-team.svg'),
  updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
});

const safeManagedImageUrl = (value: unknown) => {
  const imageUrl = String(value || '').trim().slice(0, 1000);
  if (!imageUrl) return '';
  if (imageUrl.startsWith('/') && !imageUrl.startsWith('//') && !imageUrl.includes('\\')) return imageUrl;
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
};

const safeHomeSlidePath = (value: unknown) => {
  const path = String(value || '').trim().slice(0, 300);
  if (!path) return '';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '';
  return path;
};


const safeAdActionUrl = (value: unknown) => {
  const target = String(value || '').trim().slice(0, 1000);
  if (!target) return '';
  if (target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) return target;
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
};

const normalizeAdDate = (value: unknown, fallback?: Date) => {
  if (!value) return fallback ? fallback.toISOString() : null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return fallback ? fallback.toISOString() : null;
  return date.toISOString();
};

const rowToAdCampaign = (row: any) => ({
  id: String(row.id),
  title: String(row.title || ''),
  body: String(row.body || ''),
  imageUrl: String(row.image_url || ''),
  actionLabel: String(row.action_label || ''),
  actionUrl: String(row.action_url || ''),
  audience: row.audience && typeof row.audience === 'object' ? row.audience : {},
  isActive: Boolean(row.is_active),
  startsAt: new Date(row.starts_at).toISOString(),
  endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
  maxImpressionsPerUser: Number(row.max_impressions_per_user || 1),
  cooldownHours: Number(row.cooldown_hours || 0),
  dismissible: Boolean(row.dismissible),
  priority: Number(row.priority || 0),
  impressions: Number(row.impressions || 0),
  uniqueViewers: Number(row.unique_viewers || 0),
  dismissals: Number(row.dismissals || 0),
  clicks: Number(row.clicks || 0),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const adAudienceMatches = (user: any, audience: AdminAudienceFilters) => {
  const normalized = normalizeAudienceFilters(audience || {});
  const lower = (value: unknown) => String(value || '').trim().toLowerCase();
  if (normalized.role && normalized.role !== 'all' && lower(user.role) !== normalized.role) return false;
  if (normalized.accountStatus && normalized.accountStatus !== 'all' && lower(user.account_status || 'active') !== normalized.accountStatus) return false;
  if (normalized.country && lower(user.country) !== lower(normalized.country)) return false;
  if (normalized.city && lower(user.city) !== lower(normalized.city)) return false;
  if (normalized.organization && !lower(user.organization).includes(lower(normalized.organization))) return false;
  if (normalized.jobTitle && !lower(user.job_title).includes(lower(normalized.jobTitle))) return false;
  if (normalized.userIds?.length && !normalized.userIds.includes(Number(user.id))) return false;
  return true;
};

const periodDays = (period: unknown) => {
  const value = String(period || '30d');
  if (value === '7d') return 7;
  if (value === '90d') return 90;
  if (value === '365d') return 365;
  return 30;
};

const realSparkline = async (days: number) => {
  const result = await query(
    `WITH series AS (
       SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS day
     )
     SELECT to_char(s.day,'DD/MM') AS label,
            COUNT(DISTINCT m.id)::int AS meetings,
            COUNT(DISTINCT u.id)::int AS users
       FROM series s
       LEFT JOIN room_meetings m ON m.created_at::date=s.day AND m.status<>'cancelled'
       LEFT JOIN room_users u ON u.created_at::timestamptz::date=s.day
      GROUP BY s.day ORDER BY s.day`, [Math.min(days, 31)],
  );
  return result.rows.map((row) => ({ label: row.label, meetings: Number(row.meetings), users: Number(row.users) }));
};

export const registerAdminRoutes = (app: express.Express, io: Server) => {
  const userApi = [requireDatabase, authenticateToken] as const;
  const adminApi = [requireDatabase, authenticateToken, requireAdmin] as const;

  app.get('/api/public/pages/:pageKey', requireDatabase, async (request,response,next)=>{
    try{
      const key=String(request.params.pageKey||'').trim().toLowerCase();
      if(!['security','features','privacy'].includes(key))return sendApiError(response,404,'PUBLIC_PAGE_NOT_FOUND','Page introuvable.');
      const result=await query('SELECT key,title,body,updated_at FROM room_public_pages WHERE key=$1 LIMIT 1',[key]);
      if(!result.rows[0])return sendApiError(response,404,'PUBLIC_PAGE_NOT_FOUND','Page introuvable.');
      const row=result.rows[0];
      response.setHeader('Cache-Control','public, max-age=60');
      response.json({key:String(row.key),title:String(row.title||''),body:String(row.body||''),updatedAt:new Date(row.updated_at).toISOString()});
    }catch(error){next(error);}
  });

  app.get('/api/admin/public-pages', ...adminApi, async (_request,response,next)=>{
    try{
      const result=await query('SELECT key,title,body,updated_at FROM room_public_pages ORDER BY key');
      response.json(result.rows.map((row)=>({key:String(row.key),title:String(row.title||''),body:String(row.body||''),updatedAt:new Date(row.updated_at).toISOString()})));
    }catch(error){next(error);}
  });

  app.put('/api/admin/public-pages/:pageKey', ...adminApi, async (request,response,next)=>{
    try{
      const key=String(request.params.pageKey||'').trim().toLowerCase();
      if(!['security','features','privacy'].includes(key))return sendApiError(response,404,'PUBLIC_PAGE_NOT_FOUND','Page introuvable.');
      const title=normalizeText(request.body?.title).slice(0,180);
      const body=String(request.body?.body||'').trim().slice(0,12000);
      if(!title||body.length<20)return sendApiError(response,400,'PUBLIC_PAGE_CONTENT_INVALID','Ajoutez un titre et un contenu suffisamment complet.');
      const result=await query(
        `INSERT INTO room_public_pages (key,title,body,updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (key) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=now()
         RETURNING key,title,body,updated_at`,
        [key,title,body],
      );
      const row=result.rows[0];
      const payload={key:String(row.key),title:String(row.title||''),body:String(row.body||''),updatedAt:new Date(row.updated_at).toISOString()};
      io.emit('public-page:updated',payload);
      response.json(payload);
    }catch(error){next(error);}
  });


  app.get('/api/ads/active', ...userApi, async (request: AuthedRequest, response, next) => {
    try {
      const userResult = await query(
        `SELECT id,role,country,city,organization,job_title,COALESCE(account_status,'active') AS account_status,is_guest
           FROM room_users WHERE id=$1 LIMIT 1`,
        [request.user!.id],
      );
      const user = userResult.rows[0];
      if (!user || user.is_guest) return response.status(204).end();

      const candidates = await query(
        `SELECT c.*,
                COALESCE(s.impressions,0)::int AS user_impressions,
                s.last_impression_at
           FROM room_ad_campaigns c
           LEFT JOIN room_ad_user_state s ON s.campaign_id=c.id AND s.user_id=$1
          WHERE c.is_active=true
            AND c.starts_at<=now()
            AND (c.ends_at IS NULL OR c.ends_at>now())
          ORDER BY c.priority DESC,c.created_at DESC
          LIMIT 50`,
        [request.user!.id],
      );

      const now = Date.now();
      const campaign = candidates.rows.find((row) => {
        if (!adAudienceMatches(user,row.audience || {})) return false;
        const impressions = Number(row.user_impressions || 0);
        if (impressions >= Number(row.max_impressions_per_user || 1)) return false;
        if (row.last_impression_at && Number(row.cooldown_hours || 0) > 0) {
          const elapsed = now - new Date(row.last_impression_at).getTime();
          if (elapsed < Number(row.cooldown_hours) * 3_600_000) return false;
        }
        return true;
      });

      if (!campaign) return response.status(204).end();
      response.json(rowToAdCampaign(campaign));
    } catch (error) { next(error); }
  });

  app.post('/api/ads/:campaignId/impression', ...userApi, async (request: AuthedRequest, response, next) => {
    try {
      const campaignId = String(request.params.campaignId || '').trim();
      const campaign = await query(
        `SELECT c.* FROM room_ad_campaigns c
          WHERE c.id=$1 AND c.is_active=true AND c.starts_at<=now()
            AND (c.ends_at IS NULL OR c.ends_at>now()) LIMIT 1`,
        [campaignId],
      );
      if (!campaign.rows[0]) return sendApiError(response,404,'AD_NOT_AVAILABLE','Cette campagne n’est plus disponible.');
      const userResult = await query(
        `SELECT id,role,country,city,organization,job_title,COALESCE(account_status,'active') AS account_status,is_guest
           FROM room_users WHERE id=$1 LIMIT 1`,
        [request.user!.id],
      );
      const user = userResult.rows[0];
      if (!user || user.is_guest || !adAudienceMatches(user,campaign.rows[0].audience || {})) {
        return sendApiError(response,403,'AD_AUDIENCE_DENIED','Cette campagne ne correspond pas à ce compte.');
      }
      const state = await query('SELECT impressions,last_impression_at FROM room_ad_user_state WHERE campaign_id=$1 AND user_id=$2 LIMIT 1',[campaignId,request.user!.id]);
      const existing = state.rows[0];
      const impressions = Number(existing?.impressions || 0);
      const max = Number(campaign.rows[0].max_impressions_per_user || 1);
      if (impressions >= max) return sendApiError(response,409,'AD_IMPRESSION_LIMIT','Limite d’affichage atteinte.');
      const cooldown = Number(campaign.rows[0].cooldown_hours || 0);
      if (existing?.last_impression_at && cooldown > 0 && Date.now()-new Date(existing.last_impression_at).getTime() < cooldown*3_600_000) {
        return sendApiError(response,409,'AD_COOLDOWN_ACTIVE','Cette campagne a déjà été affichée récemment.');
      }
      await query(
        `INSERT INTO room_ad_user_state (campaign_id,user_id,impressions,first_impression_at,last_impression_at)
         VALUES ($1,$2,1,now(),now())
         ON CONFLICT (campaign_id,user_id) DO UPDATE
           SET impressions=room_ad_user_state.impressions+1,
               first_impression_at=COALESCE(room_ad_user_state.first_impression_at,now()),
               last_impression_at=now()`,
        [campaignId,request.user!.id],
      );
      response.json({success:true});
    } catch (error) { next(error); }
  });

  app.post('/api/ads/:campaignId/dismiss', ...userApi, async (request: AuthedRequest, response, next) => {
    try {
      const campaignId = String(request.params.campaignId || '').trim();
      const [campaign,userResult]=await Promise.all([
        query('SELECT id,dismissible,audience FROM room_ad_campaigns WHERE id=$1 LIMIT 1',[campaignId]),
        query(`SELECT id,role,country,city,organization,job_title,COALESCE(account_status,'active') AS account_status,is_guest
                 FROM room_users WHERE id=$1 LIMIT 1`,[request.user!.id]),
      ]);
      const row=campaign.rows[0];
      const user=userResult.rows[0];
      if (!row) return sendApiError(response,404,'AD_NOT_FOUND','Campagne introuvable.');
      if (!user || user.is_guest || !adAudienceMatches(user,row.audience || {})) {
        return sendApiError(response,403,'AD_AUDIENCE_DENIED','Cette campagne ne correspond pas à ce compte.');
      }
      if (!row.dismissible) return sendApiError(response,409,'AD_NOT_DISMISSIBLE','Cette campagne doit être consultée avant de continuer.');
      await query(
        `INSERT INTO room_ad_user_state (campaign_id,user_id,dismissals,last_dismissed_at)
         VALUES ($1,$2,1,now())
         ON CONFLICT (campaign_id,user_id) DO UPDATE
           SET dismissals=room_ad_user_state.dismissals+1,last_dismissed_at=now()`,
        [campaignId,request.user!.id],
      );
      response.json({success:true});
    } catch (error) { next(error); }
  });

  app.post('/api/ads/:campaignId/click', ...userApi, async (request: AuthedRequest, response, next) => {
    try {
      const campaignId = String(request.params.campaignId || '').trim();
      const [campaign,userResult]=await Promise.all([
        query('SELECT id,audience FROM room_ad_campaigns WHERE id=$1 LIMIT 1',[campaignId]),
        query(`SELECT id,role,country,city,organization,job_title,COALESCE(account_status,'active') AS account_status,is_guest
                 FROM room_users WHERE id=$1 LIMIT 1`,[request.user!.id]),
      ]);
      const row=campaign.rows[0];
      const user=userResult.rows[0];
      if (!row) return sendApiError(response,404,'AD_NOT_FOUND','Campagne introuvable.');
      if (!user || user.is_guest || !adAudienceMatches(user,row.audience || {})) {
        return sendApiError(response,403,'AD_AUDIENCE_DENIED','Cette campagne ne correspond pas à ce compte.');
      }
      await query(
        `INSERT INTO room_ad_user_state (campaign_id,user_id,clicks,last_clicked_at)
         VALUES ($1,$2,1,now())
         ON CONFLICT (campaign_id,user_id) DO UPDATE
           SET clicks=room_ad_user_state.clicks+1,last_clicked_at=now()`,
        [campaignId,request.user!.id],
      );
      response.json({success:true});
    } catch (error) { next(error); }
  });

  app.get('/api/admin/ads', ...adminApi, async (_request, response, next) => {
    try {
      const result = await query(
        `SELECT c.*,
                COALESCE(stats.impressions,0)::int AS impressions,
                COALESCE(stats.unique_viewers,0)::int AS unique_viewers,
                COALESCE(stats.dismissals,0)::int AS dismissals,
                COALESCE(stats.clicks,0)::int AS clicks
           FROM room_ad_campaigns c
           LEFT JOIN (
             SELECT campaign_id,
                    SUM(impressions)::int AS impressions,
                    COUNT(*) FILTER (WHERE impressions>0)::int AS unique_viewers,
                    SUM(dismissals)::int AS dismissals,
                    SUM(clicks)::int AS clicks
               FROM room_ad_user_state GROUP BY campaign_id
           ) stats ON stats.campaign_id=c.id
          ORDER BY c.created_at DESC`,
      );
      response.json(result.rows.map(rowToAdCampaign));
    } catch (error) { next(error); }
  });

  app.post('/api/admin/ads', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const title = normalizeText(request.body?.title).slice(0,160);
      const body = normalizeText(request.body?.body).slice(0,1600);
      const imageUrl = safeManagedImageUrl(request.body?.imageUrl);
      const actionLabel = normalizeText(request.body?.actionLabel).slice(0,80);
      const actionUrl = safeAdActionUrl(request.body?.actionUrl);
      const audience = normalizeAudienceFilters(request.body?.audience || {role:'user',accountStatus:'active'});
      const startsAt = normalizeAdDate(request.body?.startsAt,new Date())!;
      const endsAt = normalizeAdDate(request.body?.endsAt);
      const maxImpressions = Math.max(1,Math.min(100,Number(request.body?.maxImpressionsPerUser || 1)));
      const cooldownHours = Math.max(0,Math.min(8760,Number(request.body?.cooldownHours ?? 24)));
      const priority = Math.max(0,Math.min(1000,Number(request.body?.priority || 0)));
      if (!title || !body) return sendApiError(response,400,'AD_CONTENT_REQUIRED','Ajoutez un titre et un message.');
      if (request.body?.imageUrl && !imageUrl) return sendApiError(response,400,'AD_IMAGE_INVALID','Utilisez une image HTTPS ou une ressource interne.');
      if (request.body?.actionUrl && !actionUrl) return sendApiError(response,400,'AD_ACTION_INVALID','Utilisez une destination interne ou HTTPS.');
      if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        return sendApiError(response,400,'AD_DATE_INVALID','La date de fin doit être postérieure au début.');
      }
      const result = await query(
        `INSERT INTO room_ad_campaigns
          (id,created_by,title,body,image_url,action_label,action_url,audience,is_active,starts_at,ends_at,max_impressions_per_user,cooldown_hours,dismissible,priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [createId(),request.user!.id,title,body,imageUrl,actionLabel,actionUrl,JSON.stringify(audience),request.body?.isActive===true,startsAt,endsAt,maxImpressions,cooldownHours,request.body?.dismissible!==false,priority],
      );
      const payload=rowToAdCampaign(result.rows[0]);
      io.emit('ad:campaign-updated',{id:payload.id});
      response.status(201).json(payload);
    } catch (error) { next(error); }
  });

  app.put('/api/admin/ads/:campaignId', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const campaignId=String(request.params.campaignId||'').trim();
      const current=await query('SELECT * FROM room_ad_campaigns WHERE id=$1 LIMIT 1',[campaignId]);
      const row=current.rows[0];
      if(!row)return sendApiError(response,404,'AD_NOT_FOUND','Campagne introuvable.');
      const title=normalizeText(request.body?.title ?? row.title).slice(0,160);
      const body=normalizeText(request.body?.body ?? row.body).slice(0,1600);
      const imageCandidate=request.body?.imageUrl ?? row.image_url;
      const imageUrl=safeManagedImageUrl(imageCandidate);
      const actionCandidate=request.body?.actionUrl ?? row.action_url;
      const actionUrl=safeAdActionUrl(actionCandidate);
      const actionLabel=normalizeText(request.body?.actionLabel ?? row.action_label).slice(0,80);
      const audience=normalizeAudienceFilters(request.body?.audience ?? row.audience ?? {});
      const startsAt=normalizeAdDate(request.body?.startsAt ?? row.starts_at,new Date())!;
      const endsAt=request.body?.endsAt===null ? null : normalizeAdDate(request.body?.endsAt ?? row.ends_at);
      const maxImpressions=Math.max(1,Math.min(100,Number(request.body?.maxImpressionsPerUser ?? row.max_impressions_per_user ?? 1)));
      const cooldownHours=Math.max(0,Math.min(8760,Number(request.body?.cooldownHours ?? row.cooldown_hours ?? 24)));
      const priority=Math.max(0,Math.min(1000,Number(request.body?.priority ?? row.priority ?? 0)));
      if(!title||!body)return sendApiError(response,400,'AD_CONTENT_REQUIRED','Ajoutez un titre et un message.');
      if(imageCandidate && !imageUrl)return sendApiError(response,400,'AD_IMAGE_INVALID','Utilisez une image HTTPS ou une ressource interne.');
      if(actionCandidate && !actionUrl)return sendApiError(response,400,'AD_ACTION_INVALID','Utilisez une destination interne ou HTTPS.');
      if(endsAt&&new Date(endsAt).getTime()<=new Date(startsAt).getTime())return sendApiError(response,400,'AD_DATE_INVALID','La date de fin doit être postérieure au début.');
      const result=await query(
        `UPDATE room_ad_campaigns
            SET title=$2,body=$3,image_url=$4,action_label=$5,action_url=$6,audience=$7::jsonb,
                is_active=$8,starts_at=$9,ends_at=$10,max_impressions_per_user=$11,cooldown_hours=$12,
                dismissible=$13,priority=$14,updated_at=now()
          WHERE id=$1 RETURNING *`,
        [campaignId,title,body,imageUrl,actionLabel,actionUrl,JSON.stringify(audience),typeof request.body?.isActive==='boolean'?request.body.isActive:Boolean(row.is_active),startsAt,endsAt,maxImpressions,cooldownHours,typeof request.body?.dismissible==='boolean'?request.body.dismissible:Boolean(row.dismissible),priority],
      );
      const payload=rowToAdCampaign(result.rows[0]);
      io.emit('ad:campaign-updated',{id:payload.id});
      response.json(payload);
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/ads/:campaignId', ...adminApi, async (request, response, next) => {
    try {
      const result=await query('DELETE FROM room_ad_campaigns WHERE id=$1 RETURNING id',[request.params.campaignId]);
      if(!result.rows[0])return sendApiError(response,404,'AD_NOT_FOUND','Campagne introuvable.');
      io.emit('ad:campaign-updated',{id:String(request.params.campaignId),deleted:true});
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/api/admin/settings', ...adminApi, async (_request, response, next) => {
    try {
      response.json(await getPlatformSettings());
    } catch (error) { next(error); }
  });

  app.put('/api/admin/settings', ...adminApi, async (request, response, next) => {
    try {
      const settings = await updatePlatformSettings({
        registrationEnabled: typeof request.body?.registrationEnabled === 'boolean' ? request.body.registrationEnabled : undefined,
        guestAccessEnabled: typeof request.body?.guestAccessEnabled === 'boolean' ? request.body.guestAccessEnabled : undefined,
        meetingCreationEnabled: typeof request.body?.meetingCreationEnabled === 'boolean' ? request.body.meetingCreationEnabled : undefined,
        lunaEnabled: typeof request.body?.lunaEnabled === 'boolean' ? request.body.lunaEnabled : undefined,
        recordingEnabled: typeof request.body?.recordingEnabled === 'boolean' ? request.body.recordingEnabled : undefined,
        publicMeetingsEnabled: typeof request.body?.publicMeetingsEnabled === 'boolean' ? request.body.publicMeetingsEnabled : undefined,
        premiumPaymentEnabled: typeof request.body?.premiumPaymentEnabled === 'boolean' ? request.body.premiumPaymentEnabled : undefined,
        guestRaiseHandEnabled: typeof request.body?.guestRaiseHandEnabled === 'boolean' ? request.body.guestRaiseHandEnabled : undefined,
        guestRecordingEnabled: typeof request.body?.guestRecordingEnabled === 'boolean' ? request.body.guestRecordingEnabled : undefined,
        guestScreenShareEnabled: typeof request.body?.guestScreenShareEnabled === 'boolean' ? request.body.guestScreenShareEnabled : undefined,
        guestLunaEnabled: typeof request.body?.guestLunaEnabled === 'boolean' ? request.body.guestLunaEnabled : undefined,
        guestTranscriptionEnabled: typeof request.body?.guestTranscriptionEnabled === 'boolean' ? request.body.guestTranscriptionEnabled : undefined,
        guestChatEnabled: typeof request.body?.guestChatEnabled === 'boolean' ? request.body.guestChatEnabled : undefined,
      });
      io.emit('admin:settings-updated', settings);
      response.json(settings);
    } catch (error) { next(error); }
  });

  app.get('/api/admin/admin-invites', ...adminApi, async (_request: AuthedRequest, response, next) => {
    try {
      await query("DELETE FROM room_admin_invites WHERE consumed_at IS NULL AND expires_at<=now()-interval '7 days'");
      const result = await query(
        `SELECT id,email,expires_at,consumed_at,created_at
           FROM room_admin_invites
          ORDER BY created_at DESC
          LIMIT 100`,
      );
      response.json(result.rows.map((row) => ({
        id: String(row.id),
        email: String(row.email || ''),
        expiresAt: new Date(row.expires_at).toISOString(),
        consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      })));
    } catch (error) { next(error); }
  });

  app.post('/api/admin/admin-invites', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendApiError(response,400,'ADMIN_INVITE_EMAIL_INVALID','Saisissez une adresse e-mail valide.');
      }
      const existing = await query('SELECT id,role FROM room_users WHERE lower(email)=lower($1) LIMIT 1',[email]);
      if (existing.rows[0]?.role === 'admin') {
        return sendApiError(response,409,'ADMIN_ALREADY_EXISTS','Cette adresse appartient déjà à un compte administrateur.');
      }
      const token = createToken();
      const id = createId();
      await query(
        `UPDATE room_admin_invites
            SET consumed_at=COALESCE(consumed_at,now())
          WHERE lower(email)=lower($1) AND consumed_at IS NULL`,
        [email],
      );
      const result = await query(
        `INSERT INTO room_admin_invites (id,email,token_hash,created_by,expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '24 hours')
         RETURNING id,email,expires_at,consumed_at,created_at`,
        [id,email,hashToken(token),request.user!.id],
      );
      const invitePath = '/admin/inscription?invite='+encodeURIComponent(token)+'&email='+encodeURIComponent(email);
      io.to(`user:${request.user!.id}`).emit('admin:invite-created',{id,email,expiresAt:result.rows[0].expires_at});
      response.status(201).json({
        id:String(result.rows[0].id),
        email:String(result.rows[0].email),
        invitePath,
        expiresAt:new Date(result.rows[0].expires_at).toISOString(),
        consumedAt:null,
        createdAt:new Date(result.rows[0].created_at).toISOString(),
      });
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/admin-invites/:inviteId', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const result = await query(
        `UPDATE room_admin_invites
            SET consumed_at=COALESCE(consumed_at,now())
          WHERE id=$1
          RETURNING id`,
        [request.params.inviteId],
      );
      if (!result.rows[0]) return sendApiError(response,404,'ADMIN_INVITE_NOT_FOUND','Invitation introuvable.');
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/api/admin/users', ...adminApi, async (request, response, next) => {
    try {
      const search = normalizeText(request.query.q).toLowerCase().slice(0,120);
      const term = search ? `%${search}%` : '%';
      const limit = Math.max(1, Math.min(5000, Number(request.query.limit || 1000)));
      const offset = Math.max(0, Number(request.query.offset || 0));
      const result = await query(
        `SELECT id,name,username,email,phone_number,organization,job_title,country,city,birth_date,role,is_guest,is_suspended,
                COALESCE(account_status,'active') AS account_status,
                COALESCE(feature_restrictions,'[]'::jsonb) AS feature_restrictions,
                created_at
           FROM room_users
          WHERE (lower(name) LIKE $1 OR lower(email) LIKE $1 OR lower(username) LIKE $1
                 OR lower(COALESCE(organization,'')) LIKE $1 OR lower(COALESCE(country,'')) LIKE $1 OR lower(COALESCE(city,'')) LIKE $1)
          ORDER BY is_guest ASC, created_at::timestamptz DESC
          LIMIT $2 OFFSET $3`,
        [term, limit, offset],
      );
      response.json(result.rows.map((row)=>{
        const birthDate=String(row.birth_date||'');
        const birthTime=birthDate?new Date(birthDate+'T00:00:00Z').getTime():NaN;
        const age=Number.isFinite(birthTime)?Math.max(0,Math.floor((Date.now()-birthTime)/31557600000)):null;
        return {
          id:Number(row.id),
          name:String(row.name||''),
          username:String(row.username||''),
          email:String(row.email||''),
          phoneNumber:String(row.phone_number||''),
          organization:String(row.organization||''),
          jobTitle:String(row.job_title||''),
          country:String(row.country||''),
          city:String(row.city||''),
          birthDate,
          age,
          role:String(row.role||'user'),
          isGuest:Boolean(row.is_guest),
          isSuspended:Boolean(row.is_suspended),
          accountStatus:['active','quarantined','banned'].includes(String(row.account_status))?String(row.account_status):'active',
          featureRestrictions:Array.isArray(row.feature_restrictions)?row.feature_restrictions.filter((item:unknown)=>typeof item==='string'):[],
          createdAt:new Date(row.created_at).toISOString(),
        };
      }));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/users/:userId', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const userId = Number(request.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) return sendApiError(response,400,'USER_INVALID','Utilisateur invalide.');
      const current = await query('SELECT * FROM room_users WHERE id=$1 LIMIT 1',[userId]);
      const row = current.rows[0];
      if (!row) return sendApiError(response,404,'USER_NOT_FOUND','Utilisateur introuvable.');

      const requestedSuspended = typeof request.body?.isSuspended === 'boolean' ? request.body.isSuspended : Boolean(row.is_suspended);
      const requestedStatus = ['active','quarantined','banned'].includes(String(request.body?.accountStatus))
        ? String(request.body.accountStatus)
        : (['active','quarantined','banned'].includes(String(row.account_status)) ? String(row.account_status) : 'active');
      if (userId === request.user!.id && (requestedSuspended || requestedStatus !== 'active')) {
        return sendApiError(response,400,'ADMIN_SELF_RESTRICT_FORBIDDEN','Vous ne pouvez pas suspendre, mettre en quarantaine ou bannir votre propre compte.');
      }

      const allowedRestrictions = new Set(['meetings','messages','groups','files','recording','luna','screenShare']);
      const requestedRestrictions = Array.isArray(request.body?.featureRestrictions)
        ? [...new Set(request.body.featureRestrictions.map((value:unknown)=>String(value)).filter((value:string)=>allowedRestrictions.has(value)))]
        : (Array.isArray(row.feature_restrictions) ? row.feature_restrictions : []);

      const name = normalizeText(request.body?.name ?? row.name).slice(0,120) || String(row.name);
      const organization = normalizeText(request.body?.organization ?? row.organization).slice(0,120);
      const jobTitle = normalizeText(request.body?.jobTitle ?? row.job_title).slice(0,120);
      const phoneNumber = normalizeText(request.body?.phoneNumber ?? row.phone_number).slice(0,40);
      const country = normalizeText(request.body?.country ?? row.country).slice(0,120);
      const city = normalizeText(request.body?.city ?? row.city).slice(0,120);
      const updated = await query(
        `UPDATE room_users
            SET name=$2,organization=$3,job_title=$4,phone_number=$5,is_suspended=$6,
                country=$7,city=$8,account_status=$9,feature_restrictions=$10::jsonb
          WHERE id=$1
          RETURNING id,name,username,email,phone_number,organization,job_title,country,city,birth_date,role,is_guest,is_suspended,
                    account_status,feature_restrictions,created_at`,
        [userId,name,organization,jobTitle,phoneNumber,requestedSuspended,country,city,requestedStatus,JSON.stringify(requestedRestrictions)],
      );
      if (requestedSuspended || requestedStatus === 'banned') {
        await query('DELETE FROM room_sessions WHERE user_id=$1',[userId]);
        await query('DELETE FROM room_login_otps WHERE user_id=$1',[userId]).catch(()=>undefined);
        io.in(`user:${userId}`).disconnectSockets(true);
      }
      const userUpdate={userId,isSuspended:requestedSuspended,accountStatus:requestedStatus,featureRestrictions:requestedRestrictions};
      io.to('admins').emit('admin:user-updated',userUpdate);
      io.to(`user:${userId}`).emit('account:restrictions-updated',userUpdate);
      const resultRow=updated.rows[0];
      const birthDate=String(resultRow.birth_date||'');
      const birthTime=birthDate?new Date(birthDate+'T00:00:00Z').getTime():NaN;
      response.json({
        id:Number(resultRow.id),
        name:String(resultRow.name||''),
        username:String(resultRow.username||''),
        email:String(resultRow.email||''),
        phoneNumber:String(resultRow.phone_number||''),
        organization:String(resultRow.organization||''),
        jobTitle:String(resultRow.job_title||''),
        country:String(resultRow.country||''),
        city:String(resultRow.city||''),
        birthDate,
        age:Number.isFinite(birthTime)?Math.max(0,Math.floor((Date.now()-birthTime)/31557600000)):null,
        role:String(resultRow.role||'user'),
        isGuest:Boolean(resultRow.is_guest),
        isSuspended:Boolean(resultRow.is_suspended),
        accountStatus:String(resultRow.account_status||'active'),
        featureRestrictions:Array.isArray(resultRow.feature_restrictions)?resultRow.feature_restrictions:[],
        createdAt:new Date(resultRow.created_at).toISOString(),
      });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/users/:userId/revoke-sessions', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const userId = Number(request.params.userId);
      if (!Number.isSafeInteger(userId) || userId <= 0) return sendApiError(response, 400, 'USER_INVALID', 'Utilisateur invalide.');
      if (userId === request.user!.id) return sendApiError(response, 400, 'ADMIN_SELF_REVOKE_FORBIDDEN', 'Utilisez la déconnexion pour fermer votre session.');
      const user = await query('SELECT id FROM room_users WHERE id=$1 LIMIT 1', [userId]);
      if (!user.rows[0]) return sendApiError(response, 404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
      await query('DELETE FROM room_sessions WHERE user_id=$1', [userId]);
      io.in(`user:${userId}`).disconnectSockets(true);
      io.emit('admin:user-updated', { userId, sessionsRevoked: true });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/broadcasts/audience-options', ...adminApi, async (_request, response, next) => {
    try {
      const [locations,organizations,jobs,totals] = await Promise.all([
        query("SELECT COALESCE(country,'') AS country,COALESCE(city,'') AS city,COUNT(*)::int AS count FROM room_users WHERE is_guest=false GROUP BY COALESCE(country,''),COALESCE(city,'') ORDER BY count DESC,country,city"),
        query("SELECT COALESCE(organization,'') AS value,COUNT(*)::int AS count FROM room_users WHERE is_guest=false AND COALESCE(organization,'')<>'' GROUP BY COALESCE(organization,'') ORDER BY count DESC,value LIMIT 100"),
        query("SELECT COALESCE(job_title,'') AS value,COUNT(*)::int AS count FROM room_users WHERE is_guest=false AND COALESCE(job_title,'')<>'' GROUP BY COALESCE(job_title,'') ORDER BY count DESC,value LIMIT 100"),
        query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE role='user')::int AS users,COUNT(*) FILTER (WHERE role='admin')::int AS admins,COUNT(*) FILTER (WHERE COALESCE(account_status,'active')='active')::int AS active FROM room_users WHERE is_guest=false"),
      ]);
      const countryMap = new Map<string,{name:string;count:number;cities:Array<{name:string;count:number}>}>();
      for (const row of locations.rows) {
        const country = String(row.country || '').trim() || 'Non renseigné';
        const city = String(row.city || '').trim();
        const current = countryMap.get(country) || { name:country,count:0,cities:[] };
        current.count += Number(row.count || 0);
        if (city) current.cities.push({ name:city,count:Number(row.count || 0) });
        countryMap.set(country,current);
      }
      response.json({
        countries:[...countryMap.values()].sort((a,b)=>b.count-a.count),
        organizations:organizations.rows.map((row)=>({name:String(row.value),count:Number(row.count||0)})),
        jobTitles:jobs.rows.map((row)=>({name:String(row.value),count:Number(row.count||0)})),
        totals:totals.rows[0] || {total:0,users:0,admins:0,active:0},
      });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/broadcasts/preview', ...adminApi, async (request, response, next) => {
    try {
      const filters = normalizeAudienceFilters(request.body?.audience || request.body || {});
      const audience = buildAudienceQuery(filters);
      const result = await query(
        "SELECT u.id,u.name,u.email,u.country,u.city,u.organization,u.job_title,u.role,COALESCE(u.account_status,'active') AS account_status FROM room_users u WHERE "
          + audience.where
          + " ORDER BY u.created_at::timestamptz DESC LIMIT 5001",
        audience.params,
      );
      const tooLarge = result.rows.length > 5000;
      const rows = result.rows.slice(0,5000);
      response.json({
        count:rows.length,
        tooLarge,
        sample:rows.slice(0,12).map((row)=>({
          id:Number(row.id),name:String(row.name||''),email:String(row.email||''),
          country:String(row.country||''),city:String(row.city||''),organization:String(row.organization||''),
          jobTitle:String(row.job_title||''),role:String(row.role||'user'),accountStatus:String(row.account_status||'active'),
        })),
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/broadcasts', ...adminApi, async (_request, response, next) => {
    try {
      const result = await query('SELECT * FROM room_admin_broadcasts ORDER BY created_at DESC LIMIT 50');
      response.json(result.rows.map(rowToBroadcast));
    } catch (error) { next(error); }
  });

  app.post('/api/admin/broadcasts', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const title = normalizeText(request.body?.title).slice(0,160);
      const body = normalizeText(request.body?.body).slice(0,1800);
      const actionPathRaw = String(request.body?.actionPath || '/app/notifications').trim();
      const actionPath = actionPathRaw.startsWith('/') && !actionPathRaw.startsWith('//') && !actionPathRaw.includes('\\')
        ? actionPathRaw.slice(0,300)
        : '/app/notifications';
      if (!title || !body) return sendApiError(response,400,'BROADCAST_CONTENT_REQUIRED','Ajoutez un titre et un message.');

      const filters = normalizeAudienceFilters(request.body?.audience || {});
      const audience = buildAudienceQuery(filters);
      const recipients = await query(
        'SELECT u.id,u.name,u.email FROM room_users u WHERE ' + audience.where + ' ORDER BY u.id LIMIT 5001',
        audience.params,
      );
      if (recipients.rows.length > 5000) {
        return sendApiError(response,400,'BROADCAST_AUDIENCE_TOO_LARGE','Cette diffusion dépasse 5 000 destinataires. Affinez les filtres.');
      }
      const userIds = recipients.rows.map((row)=>Number(row.id)).filter((id)=>Number.isSafeInteger(id)&&id>0);
      if (!userIds.length) return sendApiError(response,400,'BROADCAST_AUDIENCE_EMPTY','Aucun compte ne correspond à cette audience.');

      const broadcastId = createId();
      const data = { broadcastId,url:actionPath,source:'admin-broadcast' };
      const createdNotifications:any[] = [];
      for (let start=0; start<userIds.length; start+=250) {
        const chunk = userIds.slice(start,start+250);
        const params:any[] = [];
        const values = chunk.map((userId)=>{
          const id=createId();
          const base=params.length;
          params.push(id,userId,'ADMIN_BROADCAST',title,body,JSON.stringify(data));
          return '($'+(base+1)+',$'+(base+2)+',$'+(base+3)+',$'+(base+4)+',$'+(base+5)+',$'+(base+6)+'::jsonb)';
        });
        const inserted = await query(
          'INSERT INTO room_notifications (id,user_id,type,title,body,data) VALUES '
            + values.join(',')
            + ' RETURNING id,user_id,type,title,body,data,read_at,created_at',
          params,
        );
        createdNotifications.push(...inserted.rows);
      }

      for (const row of createdNotifications) {
        io.to('user:'+Number(row.user_id)).emit('notification:new',{
          id:String(row.id),userId:Number(row.user_id),type:String(row.type),title:String(row.title),body:String(row.body),
          data:row.data || data,readAt:null,createdAt:new Date(row.created_at).toISOString(),
        });
      }

      const push = request.body?.push === false
        ? {sent:0,failed:0,stale:0}
        : await sendPushToUsers(userIds,{
            title,body,url:actionPath,tag:'admin-broadcast-'+broadcastId,data,
          }).catch(()=>({sent:0,failed:userIds.length,stale:0}));

      const stored = await query(
        'INSERT INTO room_admin_broadcasts (id,created_by,title,body,action_path,audience,recipient_count,push_sent,push_failed,ai_assisted) '
          + 'VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *',
        [broadcastId,request.user!.id,title,body,actionPath,JSON.stringify(filters),userIds.length,push.sent,push.failed,request.body?.aiAssisted===true],
      );
      const payload=rowToBroadcast(stored.rows[0]);
      io.to('admins').emit('admin:broadcast-sent',payload);
      response.status(201).json({...payload,push});
    } catch (error) { next(error); }
  });

  app.post('/api/admin/ai/compose', ...adminApi, async (request, response, next) => {
    try {
      const intent=normalizeText(request.body?.intent).slice(0,800);
      const currentTitle=normalizeText(request.body?.title).slice(0,160);
      const currentBody=normalizeText(request.body?.body).slice(0,1800);
      const tone=normalizeText(request.body?.tone || 'professionnel').slice(0,60);
      if (!intent && !currentBody) return sendApiError(response,400,'AI_PROMPT_REQUIRED','Décrivez le message à préparer.');
      const groq=await callAdminGroq(
        'Tu es Luna IA, assistant de communication de MBotéRoom. Réponds uniquement avec un objet JSON {"title":"...","body":"..."}. Le message doit être clair, concis, professionnel, non trompeur et adapté à une notification utilisateur.',
        'Intention: '+(intent||currentBody)+'\nTitre actuel: '+currentTitle+'\nMessage actuel: '+currentBody+'\nTon: '+tone+'\nLangue: français.',
      );
      if (!groq) return sendApiError(response,503,'AI_NOT_CONFIGURED','Luna IA est momentanément indisponible.');
      const parsed=parseGroqJson(groq.content);
      const nextTitle=normalizeText(parsed?.title || currentTitle || 'Information MBotéRoom').slice(0,160);
      const nextBody=normalizeText(parsed?.body || groq.content).slice(0,1800);
      response.json({title:nextTitle,body:nextBody,provider:'groq',model:groq.model});
    } catch (error) { next(error); }
  });

  app.get('/api/admin/ai/insights', ...adminApi, async (_request, response, next) => {
    try {
      const [users,meetings,reports,notifications,locations]=await Promise.all([
        query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE created_at::timestamptz>=now()-interval '7 days')::int AS new_7d,COUNT(*) FILTER (WHERE COALESCE(account_status,'active')='quarantined')::int AS quarantined FROM room_users WHERE is_guest=false"),
        query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status='live' AND is_active=true)::int AS live,COUNT(*) FILTER (WHERE created_at>=now()-interval '7 days')::int AS created_7d FROM room_meetings WHERE status<>'cancelled'"),
        query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status IN ('open','reviewing'))::int AS open FROM room_reports"),
        query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE created_at>=now()-interval '7 days')::int AS created_7d FROM room_notifications"),
        query("SELECT COALESCE(country,'Non renseigné') AS country,COUNT(*)::int AS count FROM room_users WHERE is_guest=false GROUP BY COALESCE(country,'Non renseigné') ORDER BY count DESC LIMIT 5"),
      ]);
      const metrics={
        users:users.rows[0]||{},meetings:meetings.rows[0]||{},reports:reports.rows[0]||{},
        notifications:notifications.rows[0]||{},topCountries:locations.rows,
      };
      const groq=await callAdminGroq(
        'Tu es Luna IA pour les administrateurs MBotéRoom. Analyse uniquement les métriques agrégées fournies. Ne devine pas de données personnelles. Donne 4 à 6 observations opérationnelles courtes, puis 3 actions recommandées, en français.',
        JSON.stringify(metrics),
      );
      response.json({
        metrics,
        summary:groq?.content || 'L’analyse IA avancée nécessite la configuration Groq. Les métriques agrégées restent disponibles.',
        provider:groq?'groq':'local-metrics',
        model:groq?.model || null,
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/dashboard', ...adminApi, async (request, response, next) => {
    try {
      const days = periodDays(request.query.period);
      const [usersResult, meetingsResult, liveResult, recordingsResult, guestsResult, bansResult, minutesResult, liveMeetingsResult] = await Promise.all([
        query(`SELECT COUNT(*)::int AS count FROM room_users WHERE created_at::timestamptz >= now() - ($1::int || ' days')::interval`, [days]),
        query(`SELECT COUNT(*)::int AS count FROM room_meetings WHERE status<>'cancelled' AND created_at >= now() - ($1::int || ' days')::interval`, [days]),
        query(`SELECT COUNT(*)::int AS count FROM room_meetings WHERE status='live' AND is_active=true`),
        query(`SELECT COUNT(*)::int AS count FROM room_recordings`),
        query(`SELECT COUNT(*)::int AS count FROM room_users WHERE is_guest=true`),
        query(`SELECT COUNT(DISTINCT user_id)::int AS count FROM room_meeting_bans`),
        query(`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at,now())-started_at))/60),0)::int AS minutes FROM room_meetings WHERE started_at IS NOT NULL`),
        query(`SELECT * FROM room_meetings WHERE status='live' AND is_active=true ORDER BY started_at DESC LIMIT 20`),
      ]);
      const allUsers = await query(`SELECT COUNT(*)::int AS count FROM room_users`);
      const usage = await realSparkline(days);
      const totalUsers = Number(allUsers.rows[0]?.count || 0);
      const guests = Number(guestsResult.rows[0]?.count || 0);
      const activities = await query(`
        SELECT 'meeting' AS type,id::text AS id,title AS title,'Réunion créée' AS description,created_at AS created_at FROM room_meetings
        UNION ALL
        SELECT 'user' AS type,id::text AS id,name AS title,'Compte créé' AS description,created_at::timestamptz AS created_at FROM room_users
        ORDER BY created_at DESC LIMIT 10
      `);
      const stats = [
        { id:'users',label:'Utilisateurs total',value:Number(usersResult.rows[0]?.count||0),evolution:0,helper:`${days} derniers jours`,points:usage.map((x)=>x.users) },
        { id:'meetings',label:'Réunions créées',value:Number(meetingsResult.rows[0]?.count||0),evolution:0,helper:`${days} derniers jours`,points:usage.map((x)=>x.meetings) },
        { id:'live',label:'Réunions en direct',value:Number(liveResult.rows[0]?.count||0),evolution:0,helper:'En ce moment',points:usage.map((x)=>x.meetings) },
        { id:'hours',label:'Heures de réunion',value:Math.round(Number(minutesResult.rows[0]?.minutes||0)/60),suffix:'h',evolution:0,helper:'Durée réelle terminée',points:usage.map(()=>0) },
        { id:'recordings',label:'Enregistrements',value:Number(recordingsResult.rows[0]?.count||0),evolution:0,helper:'Stockage réel déclaré',points:usage.map(()=>0) },
      ];
      response.json({
        stats,
        liveMeetings: liveMeetingsResult.rows.map(publicMeeting),
        recentActivity: activities.rows.map((row)=>({ id:`${row.type}-${row.id}`,type:row.type,title:row.title,description:row.description,createdAt:new Date(row.created_at).toISOString() })),
        usage,
        distribution:{ active:Math.max(0,totalUsers-guests),guests,inactive:0,banned:Number(bansResult.rows[0]?.count||0) },
        countries:[],
        permissions:adminPermissions,
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/search', ...adminApi, async (request, response, next) => {
    try {
      const term = `%${normalizeText(request.query.q).toLowerCase()}%`;
      const [meetings, users] = await Promise.all([
        query(`SELECT * FROM room_meetings WHERE lower(title) LIKE $1 OR lower(meeting_link) LIKE $1 ORDER BY created_at DESC LIMIT 20`, [term]),
        query(`SELECT id,name,email FROM room_users WHERE lower(name) LIKE $1 OR lower(email) LIKE $1 ORDER BY name LIMIT 20`, [term]),
      ]);
      response.json({ meetings: meetings.rows.map(publicMeeting), users: users.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/meetings/:meetingId/join', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const result = await query('SELECT * FROM room_meetings WHERE id=$1 LIMIT 1',[Number(request.params.meetingId)]);
      if(!result.rows[0]) return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      const meeting=mapMeeting(result.rows[0]);
      await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,'cohost','accepted',now()) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',role='cohost',updated_at=now()`,[meeting.id,request.user!.id]);
      response.json({success:true,meeting:publicMeeting(result.rows[0])});
    }catch(error){next(error);}
  });

  app.get('/api/dashboard/tips', requireDatabase, authenticateToken, async (_request,response,next)=>{
    try{const result=await query(`SELECT * FROM room_dashboard_tips WHERE is_active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now()) ORDER BY created_at ASC`);response.json(result.rows.map(rowToTip));}catch(error){next(error);}
  });

  app.get('/api/admin/dashboard-tips', ...adminApi, async (_request,response,next)=>{
    try{const result=await query('SELECT * FROM room_dashboard_tips ORDER BY updated_at DESC');response.json(result.rows.map(rowToTip));}catch(error){next(error);}
  });
  app.post('/api/admin/dashboard-tips', ...adminApi, async (request,response,next)=>{
    try{const body=normalizeText(request.body?.body).slice(0,1000);if(!body)return sendApiError(response,400,'TIP_BODY_REQUIRED','Le contenu de l’astuce est requis.');const id=createId();const result=await query(`INSERT INTO room_dashboard_tips (id,title,body,action_label,action_path,is_active,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,normalizeText(request.body?.title).slice(0,160),body,normalizeText(request.body?.actionLabel).slice(0,80),String(request.body?.actionPath||'').slice(0,300),request.body?.isActive!==false,request.body?.startsAt||null,request.body?.endsAt||null]);const tip=rowToTip(result.rows[0]);io.emit('dashboard:tips-updated',tip);response.status(201).json(tip);}catch(error){next(error);}
  });
  app.put('/api/admin/dashboard-tips/:tipId', ...adminApi, async (request,response,next)=>{
    try{const result=await query(`UPDATE room_dashboard_tips SET title=$2,body=$3,action_label=$4,action_path=$5,is_active=$6,updated_at=now() WHERE id=$1 RETURNING *`,[request.params.tipId,normalizeText(request.body?.title).slice(0,160),normalizeText(request.body?.body).slice(0,1000),normalizeText(request.body?.actionLabel).slice(0,80),String(request.body?.actionPath||'').slice(0,300),request.body?.isActive!==false]);if(!result.rows[0])return sendApiError(response,404,'TIP_NOT_FOUND','Astuce introuvable.');const tip=rowToTip(result.rows[0]);io.emit('dashboard:tips-updated',tip);response.json(tip);}catch(error){next(error);}
  });
  app.delete('/api/admin/dashboard-tips/:tipId', ...adminApi, async (request,response,next)=>{try{await query('DELETE FROM room_dashboard_tips WHERE id=$1',[request.params.tipId]);io.emit('dashboard:tips-updated');response.status(204).end();}catch(error){next(error);}});

  app.get('/api/public/login-branding', requireDatabase, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_login_branding WHERE id=1 LIMIT 1');
      response.setHeader('Cache-Control','no-store');
      response.json(rowToLoginBranding(result.rows[0]));
    } catch (error) { next(error); }
  });

  app.get('/api/admin/login-branding', ...adminApi, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_login_branding WHERE id=1 LIMIT 1');
      response.setHeader('Cache-Control','no-store');
      response.json(rowToLoginBranding(result.rows[0]));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/login-branding', ...adminApi, async (request,response,next)=>{
    try {
      const wordmarkUrl = safeManagedImageUrl(request.body?.wordmarkUrl);
      const illustrationUrl = safeManagedImageUrl(request.body?.illustrationUrl);
      if (!wordmarkUrl || !illustrationUrl) {
        return sendApiError(response,400,'LOGIN_BRANDING_IMAGE_INVALID','Utilisez un chemin interne valide ou une URL HTTPS pour chaque image.');
      }
      const result = await query(
        `INSERT INTO room_login_branding (id,wordmark_url,illustration_url,updated_at)
         VALUES (1,$1,$2,now())
         ON CONFLICT (id) DO UPDATE SET wordmark_url=excluded.wordmark_url,illustration_url=excluded.illustration_url,updated_at=now()
         RETURNING *`,
        [wordmarkUrl,illustrationUrl],
      );
      const branding = rowToLoginBranding(result.rows[0]);
      io.emit('login:branding-updated', branding);
      response.json(branding);
    } catch (error) { next(error); }
  });

  app.get('/api/dashboard/slides', requireDatabase, authenticateToken, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_home_slides WHERE is_active=true ORDER BY slot ASC');
      response.json(result.rows.map(rowToHomeSlide));
    } catch (error) { next(error); }
  });

  app.get('/api/admin/home-slides', ...adminApi, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_home_slides ORDER BY slot ASC');
      response.json(result.rows.map(rowToHomeSlide));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/home-slides/:slot', ...adminApi, async (request,response,next)=>{
    try {
      const slot = Number(request.params.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 4) return sendApiError(response,400,'HOME_SLIDE_SLOT_INVALID','L’emplacement doit être compris entre 1 et 4.');
      const title = normalizeText(request.body?.title).slice(0,120);
      const body = normalizeText(request.body?.body).slice(0,420);
      const actionLabel = normalizeText(request.body?.actionLabel).slice(0,50);
      const actionPath = safeHomeSlidePath(request.body?.actionPath);
      const imageUrl = String(request.body?.imageUrl || '').trim().slice(0,1000);
      if (!title || !body) return sendApiError(response,400,'HOME_SLIDE_CONTENT_REQUIRED','Le titre et le message du slide sont requis.');
      if (request.body?.actionPath && !actionPath) return sendApiError(response,400,'HOME_SLIDE_PATH_INVALID','La destination du bouton doit être une route interne valide.');
      const result = await query(
        `INSERT INTO room_home_slides (slot,title,body,image_url,action_label,action_path,is_active,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (slot) DO UPDATE SET
           title=excluded.title,
           body=excluded.body,
           image_url=excluded.image_url,
           action_label=excluded.action_label,
           action_path=excluded.action_path,
           is_active=excluded.is_active,
           updated_at=now()
         RETURNING *`,
        [slot,title,body,imageUrl,actionLabel,actionPath,request.body?.isActive!==false],
      );
      const slide = rowToHomeSlide(result.rows[0]);
      io.emit('dashboard:slides-updated', slide);
      response.json(slide);
    } catch (error) { next(error); }
  });

  app.get('/api/public/guest-access-slides', requireDatabase, async (_request,response,next)=>{try{const result=await query('SELECT * FROM room_guest_access_slides WHERE is_active=true ORDER BY created_at ASC');response.json(result.rows.map(rowToSlide));}catch(error){next(error);}});
  app.get('/api/admin/guest-access-slides', ...adminApi, async (_request,response,next)=>{try{const result=await query('SELECT * FROM room_guest_access_slides ORDER BY updated_at DESC');response.json(result.rows.map(rowToSlide));}catch(error){next(error);}});
  app.post('/api/admin/guest-access-slides', ...adminApi, async (request,response,next)=>{try{const title=normalizeText(request.body?.title).slice(0,160);const body=normalizeText(request.body?.body).slice(0,1200);if(!title||!body)return sendApiError(response,400,'SLIDE_CONTENT_REQUIRED','Titre et contenu requis.');const id=createId();const result=await query(`INSERT INTO room_guest_access_slides (id,title,body,image_url,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,[id,title,body,String(request.body?.imageUrl||'').slice(0,1000),request.body?.isActive!==false]);response.status(201).json(rowToSlide(result.rows[0]));}catch(error){next(error);}});
  app.put('/api/admin/guest-access-slides/:slideId', ...adminApi, async (request,response,next)=>{try{const result=await query(`UPDATE room_guest_access_slides SET title=$2,body=$3,image_url=$4,is_active=$5,updated_at=now() WHERE id=$1 RETURNING *`,[request.params.slideId,normalizeText(request.body?.title).slice(0,160),normalizeText(request.body?.body).slice(0,1200),String(request.body?.imageUrl||'').slice(0,1000),request.body?.isActive!==false]);if(!result.rows[0])return sendApiError(response,404,'SLIDE_NOT_FOUND','Slide introuvable.');response.json(rowToSlide(result.rows[0]));}catch(error){next(error);}});
  app.delete('/api/admin/guest-access-slides/:slideId', ...adminApi, async (request,response,next)=>{try{await query('DELETE FROM room_guest_access_slides WHERE id=$1',[request.params.slideId]);response.status(204).end();}catch(error){next(error);}});
};
