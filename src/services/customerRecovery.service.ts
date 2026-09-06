import { sb } from '../config/supabase';
import { normalizePagination, type PaginationOptions } from './pagination';
import { createAuditLog } from './audit.service';

export type CustomerMessagingMode = 'manual_sms';

export type CustomerRecoveryStatus =
  | 'queued'
  | 'manual_draft_opened'
  | 'manual_sent'
  | 'sent'
  | 'delivered'
  | 'replied'
  | 'appointment_requested'
  | 'appointment_confirmed'
  | 'no_response'
  | 'failed'
  | 'opted_out'
  | 'closed';

export type CustomerRecoveryInput = {
  routeId: string;
  jobId: string;
  techId: string;
  techName?: string;
  region: string;
  phone: string;
  address?: string;
  reason: string;
  language?: 'en' | 'es';
};

export const CUSTOMER_RECOVERY_MESSAGE_EN =
  'A Comcast/Xfinity field technician visited your property today but could not access the work area or reach anyone. We need to schedule a return visit. Reply 1 for today, 2 for tomorrow, or send the date and time that works best. Reply STOP to opt out.';

export const CUSTOMER_RECOVERY_MESSAGE_ES =
  'Un técnico de campo de Comcast/Xfinity visitó su propiedad hoy, pero no pudo acceder al área de trabajo ni comunicarse con nadie. Necesitamos programar una visita de regreso. Responda 1 para hoy, 2 para mañana, o envíe la fecha y hora que más le convenga. Responda STOP para dejar de recibir mensajes.';

const RECOVERABLE_TERMS = [
  'customer ausente',
  'customer absent',
  'customer not home',
  'customer unavailable',
  'no access',
  'appointment required',
  'gate locked',
  'unable to contact',
  'no one home',
];

function modeKey(region: string) {
  return `gfs_customer_messaging_mode_${region || 'default'}`;
}

export function getCustomerMessagingMode(_region: string): CustomerMessagingMode {
  return 'manual_sms';
}

export async function setCustomerMessagingMode(
  region: string,
  mode: CustomerMessagingMode,
  actorName = 'Admin',
  actorRole = 'admin',
) {
  localStorage.setItem(modeKey(region), mode);
  try {
    await sb.from('customer_messaging_settings').upsert(
      {
        region,
        mode,
        updated_by: actorName,
        updated_by_role: actorRole,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'region' },
    );
  } catch (error) {
    console.warn('Messaging settings table unavailable; local setting is still active.', error);
  }
  await createAuditLog({
    action: 'customer_messaging_mode_updated',
    entity: 'customer_messaging_settings',
    entityId: region,
    metadata: {
      region,
      actorName,
      actorRole,
      mode,
      summary: `Customer messaging mode changed to ${mode}`,
    },
  }).catch(() => {});
}

export async function loadCustomerMessagingMode(region: string): Promise<CustomerMessagingMode> {
  try {
    const { data, error } = await sb
      .from('customer_messaging_settings')
      .select('mode')
      .eq('region', region)
      .maybeSingle();
    if (error) throw error;
    if (data?.mode === 'manual_sms') {
      localStorage.setItem(modeKey(region), data.mode);
      return data.mode;
    }
  } catch (error) {
    console.warn('Unable to load messaging mode from Supabase; using local mode.', error);
  }
  return getCustomerMessagingMode(region);
}

export function isRecoverableReason(reason?: string | null) {
  const normalized = String(reason || '').toLowerCase();
  return RECOVERABLE_TERMS.some((term) => normalized.includes(term));
}

export function normalizePhone(phone?: string | null) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export function getCustomerRecoveryMessage(language: 'en' | 'es' = 'en') {
  return language === 'es' ? CUSTOMER_RECOVERY_MESSAGE_ES : CUSTOMER_RECOVERY_MESSAGE_EN;
}

function localKey(region: string) {
  return `gfs_customer_recovery_${region}`;
}

function localMessagesKey(region: string) {
  return `gfs_customer_messages_${region}`;
}

function saveLocalFallback(input: CustomerRecoveryInput, status: CustomerRecoveryStatus, message: string) {
  const key = localKey(input.region);
  let rows: any[] = [];
  try {
    rows = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    rows = [];
  }
  const now = new Date().toISOString();
  const existingIndex = rows.findIndex((row) => String(row.route_id) === String(input.routeId));
  const row = {
    id: rows[existingIndex]?.id || `local-${Date.now()}-${input.routeId}`,
    route_id: input.routeId,
    job_id: input.jobId,
    tech_id: input.techId,
    tech_name: input.techName || input.techId,
    region: input.region,
    customer_phone: normalizePhone(input.phone),
    address: input.address || '',
    original_reason: input.reason,
    message_body: message,
    language: input.language || 'en',
    contact_method: 'manual_sms',
    status,
    created_at: rows[existingIndex]?.created_at || now,
    updated_at: now,
    source: 'local_fallback',
    ...rows[existingIndex],
  };
  // Ensure the new values win over the existing record.
  Object.assign(row, {
    route_id: input.routeId,
    job_id: input.jobId,
    tech_id: input.techId,
    tech_name: input.techName || input.techId,
    region: input.region,
    customer_phone: normalizePhone(input.phone),
    address: input.address || '',
    original_reason: input.reason,
    message_body: message,
    language: input.language || 'en',
    updated_at: now,
  });
  if (existingIndex >= 0) rows[existingIndex] = row;
  else rows.unshift(row);
  localStorage.setItem(key, JSON.stringify(rows.slice(0, 500)));
  return row;
}

function saveLocalMessage(region: string, message: Record<string, unknown>) {
  const key = localMessagesKey(region);
  let rows: any[] = [];
  try {
    rows = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    rows = [];
  }
  rows.unshift({ id: `local-message-${Date.now()}`, created_at: new Date().toISOString(), ...message });
  localStorage.setItem(key, JSON.stringify(rows.slice(0, 1000)));
}

export async function queueCustomerRecovery(input: CustomerRecoveryInput) {
  const language = input.language || 'en';
  const message = getCustomerRecoveryMessage(language);
  const payload = {
    route_id: input.routeId,
    job_id: input.jobId,
    tech_id: input.techId,
    tech_name: input.techName || input.techId,
    region: input.region,
    customer_phone: normalizePhone(input.phone),
    address: input.address || '',
    original_reason: input.reason,
    language,
    message_body: message,
    contact_method: getCustomerMessagingMode(input.region),
    status: 'queued',
    updated_at: new Date().toISOString(),
  };

  let row: any = null;
  try {
    const { data: existing, error: existingError } = await sb
      .from('customer_outreach')
      .select('*')
      .eq('route_id', input.routeId)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const { status: _ignoredStatus, ...safeUpdate } = payload;
      const { data, error } = await sb
        .from('customer_outreach')
        .update(safeUpdate)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      row = data || existing;
    } else {
      const { data, error } = await sb
        .from('customer_outreach')
        .insert(payload)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      row = data;
    }
  } catch (error) {
    console.warn('Customer recovery table unavailable; using local fallback.', error);
    row = saveLocalFallback(input, 'queued', message);
  }

  await createAuditLog({
    action: 'customer_recovery_queued',
    entity: 'customer_outreach',
    entityId: row?.id || input.routeId,
    metadata: {
      region: input.region,
      actorRole: 'technician',
      actorName: input.techName || input.techId,
      tech_id: input.techId,
      job_id: input.jobId,
      phone: normalizePhone(input.phone),
      reason: input.reason,
      messaging_mode: getCustomerMessagingMode(input.region),
      summary: `Customer recovery queued for job ${input.jobId}`,
    },
  }).catch(() => {});

  return { row, delivery: 'queued' as const, message };
}

export async function fetchCustomerRecovery(region: string, pagination: PaginationOptions = {}) {
  const { from, to } = normalizePagination(pagination);
  try {
    const { data, error } = await sb
      .from('customer_outreach')
      .select('*')
      .eq('region', region)
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('Customer recovery table unavailable; reading local fallback.', error);
    try {
      const localRows = JSON.parse(localStorage.getItem(localKey(region)) || '[]') || [];
      return localRows.slice(from, to + 1);
    } catch {
      return [];
    }
  }
}

export async function updateCustomerRecovery(id: string, update: Record<string, unknown>, region: string) {
  if (String(id).startsWith('local-')) {
    const key = localKey(region);
    const rows = JSON.parse(localStorage.getItem(key) || '[]') || [];
    const updated = rows.map((row: any) =>
      row.id === id ? { ...row, ...update, updated_at: new Date().toISOString() } : row,
    );
    localStorage.setItem(key, JSON.stringify(updated));
    return;
  }
  const { error } = await sb
    .from('customer_outreach')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

async function saveCustomerMessage(
  outreachId: string,
  region: string,
  payload: Record<string, unknown>,
) {
  if (String(outreachId).startsWith('local-')) {
    saveLocalMessage(region, { outreach_id: outreachId, ...payload });
    return;
  }
  try {
    const { error } = await sb.from('customer_messages').insert({ outreach_id: outreachId, ...payload });
    if (error) throw error;
  } catch (error) {
    console.warn('Unable to save customer message event; using local fallback.', error);
    saveLocalMessage(region, { outreach_id: outreachId, ...payload });
  }
}

export function buildSmsUri(phone: string, message: string) {
  const normalized = normalizePhone(phone);
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return `sms:${normalized}${isApple ? '&' : '?'}body=${encodeURIComponent(message)}`;
}

export function openCustomerSms(phone: string, language: 'en' | 'es' = 'en') {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('This job does not have a valid customer phone number.');
  const message = getCustomerRecoveryMessage(language);
  window.location.href = buildSmsUri(normalized, message);
}

export async function markManualDraftOpened(args: {
  outreachId: string;
  region: string;
  phone: string;
  language?: 'en' | 'es';
  actorName: string;
  actorRole: string;
  jobId?: string;
  techId?: string;
}) {
  const now = new Date().toISOString();
  await updateCustomerRecovery(
    args.outreachId,
    {
      status: 'manual_draft_opened',
      contact_method: 'manual_sms',
      last_contacted_at: now,
      metadata: { manual_sms_notice: 'Opening the composer does not prove the SMS was sent.' },
    },
    args.region,
  );
  await saveCustomerMessage(args.outreachId, args.region, {
    direction: 'outbound',
    provider: 'device_sms',
    to_number: normalizePhone(args.phone),
    body: getCustomerRecoveryMessage(args.language || 'en'),
    status: 'draft_opened',
    metadata: { self_reported: true, actor_name: args.actorName, actor_role: args.actorRole },
  });
  await createAuditLog({
    action: 'customer_manual_sms_draft_opened',
    entity: 'customer_outreach',
    entityId: args.outreachId,
    metadata: {
      region: args.region,
      actorName: args.actorName,
      actorRole: args.actorRole,
      job_id: args.jobId,
      tech_id: args.techId,
      phone: normalizePhone(args.phone),
      summary: `Manual SMS composer opened for job ${args.jobId || ''}`,
    },
  }).catch(() => {});
}

export async function markManualSmsSent(args: {
  outreachId: string;
  region: string;
  phone: string;
  language?: 'en' | 'es';
  actorName: string;
  actorRole: string;
  jobId?: string;
  techId?: string;
}) {
  const now = new Date().toISOString();
  await updateCustomerRecovery(
    args.outreachId,
    {
      status: 'manual_sent',
      contact_method: 'manual_sms',
      manual_sent_at: now,
      manual_sent_by: args.actorName,
      last_contacted_at: now,
    },
    args.region,
  );
  await saveCustomerMessage(args.outreachId, args.region, {
    direction: 'outbound',
    provider: 'device_sms',
    to_number: normalizePhone(args.phone),
    body: getCustomerRecoveryMessage(args.language || 'en'),
    status: 'manual_sent',
    sent_at: now,
    metadata: {
      self_reported: true,
      actor_name: args.actorName,
      actor_role: args.actorRole,
      disclaimer: 'The app cannot independently verify delivery for device SMS.',
    },
  });
  await createAuditLog({
    action: 'customer_manual_sms_marked_sent',
    entity: 'customer_outreach',
    entityId: args.outreachId,
    metadata: {
      region: args.region,
      actorName: args.actorName,
      actorRole: args.actorRole,
      job_id: args.jobId,
      tech_id: args.techId,
      phone: normalizePhone(args.phone),
      self_reported: true,
      summary: `Manual SMS marked sent for job ${args.jobId || ''}`,
    },
  }).catch(() => {});
}

function dateInDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

export async function recordManualCustomerReply(args: {
  outreachId: string;
  region: string;
  reply: string;
  actorName: string;
  actorRole: string;
  jobId?: string;
  techId?: string;
}) {
  const raw = args.reply.trim();
  const normalized = raw.toLowerCase();
  const optedOut = /(^|\s)(stop|unsubscribe|cancel|end|quit)(\s|$)/i.test(raw);
  let nextStatus: CustomerRecoveryStatus = 'replied';
  let appointmentDate: string | null = null;

  if (optedOut) nextStatus = 'opted_out';
  else if (normalized === '1' || normalized.includes('today') || normalized.includes('hoy')) {
    nextStatus = 'appointment_requested';
    appointmentDate = dateInDays(0);
  } else if (normalized === '2' || normalized.includes('tomorrow') || normalized.includes('mañana')) {
    nextStatus = 'appointment_requested';
    appointmentDate = dateInDays(1);
  } else if (/\b(appointment|schedule|date|time|cita|fecha|hora)\b/i.test(raw)) {
    nextStatus = 'appointment_requested';
  }

  const now = new Date().toISOString();
  await updateCustomerRecovery(
    args.outreachId,
    {
      status: nextStatus,
      latest_reply: raw,
      replied_at: now,
      appointment_date: appointmentDate,
      ...(optedOut ? { opted_out_at: now } : {}),
    },
    args.region,
  );

  await saveCustomerMessage(args.outreachId, args.region, {
    direction: 'inbound',
    provider: 'device_sms_manual_entry',
    body: raw,
    status: 'recorded',
    metadata: {
      self_reported: true,
      actor_name: args.actorName,
      actor_role: args.actorRole,
      detected_status: nextStatus,
    },
  });

  if (!String(args.outreachId).startsWith('local-')) {
    try {
      await sb.from('customer_replies').insert({
        outreach_id: args.outreachId,
        body: raw,
        detected_language: /[áéíóúñ¿¡]/i.test(raw) ? 'es' : 'unknown',
        intent: nextStatus,
        preferred_date: appointmentDate,
        requires_human_review: true,
        ai_result: { source: 'manual_entry', opted_out: optedOut },
      });
    } catch (error) {
      console.warn('Unable to save customer reply record.', error);
    }
  }

  await createAuditLog({
    action: optedOut ? 'customer_opted_out_recorded' : 'customer_reply_recorded_manually',
    entity: 'customer_outreach',
    entityId: args.outreachId,
    metadata: {
      region: args.region,
      actorName: args.actorName,
      actorRole: args.actorRole,
      job_id: args.jobId,
      tech_id: args.techId,
      reply: raw,
      next_status: nextStatus,
      appointment_date: appointmentDate,
      summary: `Customer reply recorded for job ${args.jobId || ''}`,
    },
  }).catch(() => {});

  return { status: nextStatus, appointmentDate };
}

export async function markCustomerNoResponse(args: {
  outreachId: string;
  region: string;
  actorName: string;
  actorRole: string;
  jobId?: string;
  techId?: string;
}) {
  const now = new Date().toISOString();
  await updateCustomerRecovery(
    args.outreachId,
    { status: 'no_response', no_response_at: now },
    args.region,
  );
  await createAuditLog({
    action: 'customer_no_response_recorded',
    entity: 'customer_outreach',
    entityId: args.outreachId,
    metadata: {
      region: args.region,
      actorName: args.actorName,
      actorRole: args.actorRole,
      job_id: args.jobId,
      tech_id: args.techId,
      summary: `No customer response recorded for job ${args.jobId || ''}`,
    },
  }).catch(() => {});
}

export async function copyCustomerRecoveryMessage(language: 'en' | 'es' = 'en') {
  const message = getCustomerRecoveryMessage(language);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(message);
    return;
  }
  const area = document.createElement('textarea');
  area.value = message;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
