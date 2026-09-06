import { sb } from '../../config/supabase';

export async function upsertCustomer(customer: any) {
  if (customer.id) return sb.from('customers').update(customer).eq('id', customer.id).select().single();
  if (customer.account_number) {
    const existing = await sb.from('customers').select('id').eq('account_number', customer.account_number).maybeSingle();
    if (existing.error) return existing as any;
    if (existing.data?.id) return sb.from('customers').update(customer).eq('id', existing.data.id).select().single();
  }
  return sb.from('customers').insert(customer).select().single();
}

export async function searchCustomers(term: string) {
  let query = sb.from('customers').select('*').order('updated_at', { ascending: false }).limit(50);
  if (term.trim()) {
    const safe = term.replace(/[,%()]/g, ' ');
    query = query.or(`name.ilike.%${safe}%,account_number.ilike.%${safe}%,phone.ilike.%${safe}%,address.ilike.%${safe}%`);
  }
  return query;
}

export async function getCustomerHistory(customerId: string) {
  return sb.from('routes').select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
}

export async function deleteCustomer(id: string) {
  return sb.from('customers').delete().eq('id', id);
}
