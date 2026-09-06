import { sb } from '../config/supabase';
import { deriveCity } from './city.util';

type LearningEventInput = {
  event_type: 'not_done_added' | 'not_done_repeated' | 'resolved_completed' | 'resolved_cancelled' | 'matched_new_route';
  region?: string;
  job_id: string;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  reason?: string | null;
  category?: string | null;
  tech_id?: string | null;
  tech_name?: string | null;
  occurrence_count?: number;
  days_pending?: number;
  metadata?: Record<string, unknown>;
};

const clean = (v: unknown) => String(v ?? '').trim();

export async function feedCharlieLearning(input: LearningEventInput): Promise<void> {
  try {
    const city = clean(input.city) || deriveCity(input.address || '', input.zip || '');
    const payload = {
      event_type: input.event_type,
      region: clean(input.region) || 'miami',
      city: city || null,
      job_id: clean(input.job_id),
      address: clean(input.address) || null,
      zip: clean(input.zip) || null,
      reason: clean(input.reason) || null,
      category: clean(input.category) || null,
      tech_id: clean(input.tech_id) || null,
      tech_name: clean(input.tech_name) || null,
      occurrence_count: input.occurrence_count || 1,
      days_pending: input.days_pending || 0,
      metadata: input.metadata || {},
    };
    if (!payload.job_id) return;
    await sb.from('charlie_learning_events').insert(payload);
  } catch {}
}

export async function charlieCountByReason(reason: string, dateFrom?: string, dateTo?: string) {
  try {
    let q: any = sb.from('charlie_learning_events').select('id', { count: 'exact', head: true }).ilike('reason', `%${reason}%`).in('event_type', ['not_done_added', 'not_done_repeated']);
    if (dateFrom) q = q.gte('event_date', dateFrom);
    if (dateTo) q = q.lte('event_date', dateTo);
    const { count } = await q;
    return count || 0;
  } catch { return 0; }
}

export async function charlieCountByCity(city: string, dateFrom?: string, dateTo?: string) {
  try {
    let q: any = sb.from('charlie_learning_events').select('id', { count: 'exact', head: true }).eq('city', city.toUpperCase()).in('event_type', ['not_done_added', 'not_done_repeated']);
    if (dateFrom) q = q.gte('event_date', dateFrom);
    if (dateTo) q = q.lte('event_date', dateTo);
    const { count } = await q;
    return count || 0;
  } catch { return 0; }
}

export async function charlieTopReasons(limit = 5, dateFrom?: string, dateTo?: string) {
  try {
    let q: any = sb.from('charlie_learning_events').select('reason').in('event_type', ['not_done_added', 'not_done_repeated']).not('reason', 'is', null);
    if (dateFrom) q = q.gte('event_date', dateFrom);
    if (dateTo) q = q.lte('event_date', dateTo);
    const { data } = await q.limit(5000);
    const tally = new Map<string, number>();
    for (const row of data || []) {
      const r = String((row as any).reason || '').trim();
      if (!r) continue;
      tally.set(r, (tally.get(r) || 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([reason, count]) => ({ reason, count }));
  } catch { return []; }
}

export async function charlieTechHotspots(dateFrom?: string, dateTo?: string) {
  try {
    let q: any = sb.from('charlie_learning_events').select('tech_id,tech_name,city,reason').in('event_type', ['not_done_added', 'not_done_repeated']).not('tech_id', 'is', null);
    if (dateFrom) q = q.gte('event_date', dateFrom);
    if (dateTo) q = q.lte('event_date', dateTo);
    const { data } = await q.limit(5000);
    const tally = new Map<string, { tech_id: string; tech_name: string; count: number; top_city: string; top_reason: string }>();
    for (const row of data || []) {
      const t = String((row as any).tech_id || '').trim();
      if (!t) continue;
      const cur = tally.get(t) || { tech_id: t, tech_name: String((row as any).tech_name || ''), count: 0, top_city: '', top_reason: '' };
      cur.count += 1;
      tally.set(t, cur);
    }
    return [...tally.values()].sort((a, b) => b.count - a.count);
  } catch { return []; }
}
