// GUAJIRO V25.2 — Customer messaging (gate access code request).
// Provides the bilingual (EN+ES in ONE message) template the supervisor
// sends to customers before the crew arrives, plus helpers to read today's
// route (from the supervisor local cache) and build one-tap sms: links.
//
// IMPORTANT SCOPE NOTE:
// - Sending is done through the device's own SMS app via sms: links —
//   one tap per customer. TRUE one-click send to the whole route, and
//   customer REPLIES landing automatically as a note on the technician's
//   job, both require Twilio (a real phone number + inbound webhook).
//   Twilio is intentionally NOT activated yet — see README_V26_TWILIO_TWO_WAY_PLAN.md.

export type RouteMessageTarget = {
  jobId: string;
  techId: string;
  address: string;
  phone: string; // 10 digits or ''
};

export const GATE_ACCESS_TEMPLATE =
  'Hello! This is the Xfinity cable burial team. We will be visiting your address soon to bury your cable line. ' +
  'If your community or home has a GATE or ACCESS CODE, please reply to this message with the code so our technician can enter. Thank you!\n' +
  '----------\n' +
  '¡Hola! Somos el equipo de enterrado de cable de Xfinity. Pronto visitaremos su dirección para enterrar su línea de cable. ' +
  'Si su comunidad o casa tiene PORTÓN o CÓDIGO DE ACCESO, por favor responda a este mensaje con el código para que nuestro técnico pueda entrar. ¡Gracias!';

/** Reads today's (or most recent cached) route for a region from the
 *  supervisor local cache and returns messageable jobs (valid 10-digit phone). */
export function getRouteMessageTargets(): { date: string; region: string; targets: RouteMessageTarget[]; skippedNoPhone: number } {
  const prefix = 'gfs_supervisor_routes_';
  let bestKey = '';
  let bestDate = '';
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith(prefix)) continue;
      const date = key.split('_').pop() || '';
      if (date > bestDate) { bestDate = date; bestKey = key; }
    }
    if (!bestKey) return { date: '', region: '', targets: [], skippedNoPhone: 0 };
    const rows = JSON.parse(localStorage.getItem(bestKey) || '[]') || [];
    const region = bestKey.slice(prefix.length).split('_')[0] || '';
    let skippedNoPhone = 0;
    const seen = new Set<string>();
    const targets: RouteMessageTarget[] = [];
    for (const row of rows) {
      const phone = String(row?.phone || '').replace(/\D/g, '').slice(-10);
      if (phone.length !== 10) { skippedNoPhone += 1; continue; }
      if (seen.has(phone)) continue; // one message per phone, not per job
      seen.add(phone);
      targets.push({
        jobId: String(row?.job_id || ''),
        techId: String(row?.tech_id || ''),
        address: String(row?.address || ''),
        phone,
      });
    }
    return { date: bestDate, region, targets, skippedNoPhone };
  } catch {
    return { date: '', region: '', targets: [], skippedNoPhone: 0 };
  }
}

/** Builds an sms: link that opens the phone's messaging app with the
 *  bilingual message pre-filled. Works on iOS and Android. */
export function buildSmsLink(phone: string, body: string = GATE_ACCESS_TEMPLATE): string {
  return `sms:+1${phone}?&body=${encodeURIComponent(body)}`;
}

/** Newline-separated phone list for pasting into a group/broadcast app. */
export function buildPhoneList(targets: RouteMessageTarget[]): string {
  return targets.map((t) => `+1${t.phone}`).join('\n');
}
