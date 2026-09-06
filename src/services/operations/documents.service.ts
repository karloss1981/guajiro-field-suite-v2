import { sb } from '../../config/supabase';

export async function getDocuments(category?: string) {
  let query = sb.from('documents').select('*').order('uploaded_at', { ascending: false });
  if (category) query = query.eq('category', category);
  return query;
}

export async function createDocument(input: { name: string; category: string; file_url: string; cache_offline?: boolean }) {
  return sb.from('documents').insert(input).select().single();
}

export async function deleteDocument(id: string) {
  return sb.from('documents').delete().eq('id', id);
}
