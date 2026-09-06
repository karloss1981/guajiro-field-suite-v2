import { sb } from '../../../config/supabase';

// ── GPS CONSENT ──
async function saveGpsConsent(techId: string) {
  let ip = '';
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    ip = d.ip || '';
  } catch {}
  await sb.from('technicians').update({
    gps_consent: true,
    gps_consent_at: new Date().toISOString(),
    gps_consent_ip: ip,
  }).eq('id', techId);
}

export { saveGpsConsent };
