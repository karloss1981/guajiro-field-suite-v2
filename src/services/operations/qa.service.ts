import { sb } from '../../config/supabase';

export async function createQAReview(input: {
  route_id?: string;
  job_id?: string;
  reviewer_id?: string;
  score: number;
  passed: boolean;
  comments?: string;
  checklist?: Record<string, unknown>;
}) {
  return sb.from('qa_reviews').insert(input).select().single();
}

export async function getQAReviews(routeId?: string) {
  let query = sb.from('qa_reviews').select('*').order('reviewed_at', { ascending: false });
  if (routeId) query = query.eq('route_id', routeId);
  return query;
}

export async function deleteQAReview(id: string) {
  return sb.from('qa_reviews').delete().eq('id', id);
}

export async function getQADashboard() {
  return sb.from('qa_dashboard').select('*').single();
}

export function calculateQAScore(checklist: Record<string, boolean>) {
  const values = Object.values(checklist);
  if (!values.length) return 0;
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}
