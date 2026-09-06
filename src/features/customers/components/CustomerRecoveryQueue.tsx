// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C } from '../../../config/theme';
import {
  copyCustomerRecoveryMessage,
  fetchCustomerRecovery,
  getCustomerRecoveryMessage,
  markCustomerNoResponse,
  markManualDraftOpened,
  markManualSmsSent,
  openCustomerSms,
  recordManualCustomerReply,
  updateCustomerRecovery,
} from '../../../services/customerRecovery.service';
import { createAuditLog } from '../../../services/audit.service';

const PAGE_SIZE = 50;

export default function CustomerRecoveryQueue({ region, lang = 'en', actorName = 'Supervisor', actorRole = 'supervisor' }) {
  const es = lang === 'es';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [dialog, setDialog] = useState<'appointment' | 'reply' | null>(null);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentWindow, setAppointmentWindow] = useState('');
  const [replyText, setReplyText] = useState('');
  const [notice, setNotice] = useState('');

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const recoveryRows = await fetchCustomerRecovery(region, { page: 0, pageSize: PAGE_SIZE });
    setRows(recoveryRows);
    setPage(0);
    setHasMore(recoveryRows.length === PAGE_SIZE);
    setLoading(false);
  }, [region]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    const recoveryRows = await fetchCustomerRecovery(region, { page: nextPage, pageSize: PAGE_SIZE });
    setRows((current) => {
      const seen = new Set(current.map((row) => String(row.id)));
      const merged = [...current];
      for (const row of recoveryRows) {
        if (!seen.has(String(row.id))) merged.push(row);
      }
      return merged;
    });
    setPage(nextPage);
    setHasMore(recoveryRows.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [hasMore, loadingMore, page, region]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (!q) return true;
      return [row.job_id, row.address, row.tech_id, row.tech_name, row.customer_phone, row.original_reason, row.latest_reply]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, query, status]);

  const setRowStatus = async (row: any, nextStatus: string, extra: Record<string, unknown> = {}) => {
    await updateCustomerRecovery(row.id, { status: nextStatus, ...extra }, region);
    await createAuditLog({
      action: `customer_recovery_${nextStatus}`,
      entity: 'customer_outreach',
      entityId: row.id,
      metadata: {
        region,
        actorRole,
        actorName,
        job_id: row.job_id,
        tech_id: row.tech_id,
        summary: `Customer recovery ${nextStatus} for job ${row.job_id}`,
        ...extra,
      },
    }).catch(() => {});
    closeDialog();
    await load();
  };

  const closeDialog = () => {
    setSelected(null);
    setDialog(null);
    setAppointmentDate('');
    setAppointmentWindow('');
    setReplyText('');
  };

  const openManualSms = async (row: any) => {
    if (!row.customer_phone) {
      flash(es ? 'Este trabajo no tiene teléfono.' : 'This job has no phone number.');
      return;
    }
    try {
      await markManualDraftOpened({
        outreachId: row.id,
        region,
        phone: row.customer_phone,
        language: row.language || 'en',
        actorName,
        actorRole,
        jobId: row.job_id,
        techId: row.tech_id,
      });
      openCustomerSms(row.customer_phone, row.language || 'en');
      flash(es ? 'Se abrió el SMS. El usuario todavía debe presionar Send.' : 'SMS opened. The user must still press Send.');
      await load();
    } catch (error: any) {
      flash(`❌ ${error?.message || 'Unable to open SMS'}`);
    }
  };

  const sendUsingConfiguredMode = async (row: any) => openManualSms(row);

  const confirmManualSent = async (row: any) => {
    await markManualSmsSent({
      outreachId: row.id,
      region,
      phone: row.customer_phone,
      language: row.language || 'en',
      actorName,
      actorRole,
      jobId: row.job_id,
      techId: row.tech_id,
    });
    flash(es ? 'SMS marcado como enviado. Este registro es confirmado manualmente.' : 'SMS marked sent. This is a manual confirmation.');
    await load();
  };

  const submitReply = async () => {
    if (!selected || !replyText.trim()) return;
    const parsed = await recordManualCustomerReply({
      outreachId: selected.id,
      region,
      reply: replyText.trim(),
      actorName,
      actorRole,
      jobId: selected.job_id,
      techId: selected.tech_id,
    });
    flash(parsed.status === 'appointment_requested'
      ? (es ? 'Respuesta y solicitud de cita registradas.' : 'Reply and appointment request recorded.')
      : parsed.status === 'opted_out'
        ? (es ? 'Opt-out registrado. No envíes más mensajes.' : 'Opt-out recorded. Do not send more messages.')
        : (es ? 'Respuesta registrada.' : 'Reply recorded.'));
    closeDialog();
    await load();
  };

  const noResponse = async (row: any) => {
    await markCustomerNoResponse({
      outreachId: row.id,
      region,
      actorName,
      actorRole,
      jobId: row.job_id,
      techId: row.tech_id,
    });
    flash(es ? 'Sin respuesta registrado.' : 'No response recorded.');
    await load();
  };

  const copyMessage = async (row: any) => {
    await copyCustomerRecoveryMessage(row.language || 'en');
    flash(es ? 'Mensaje copiado.' : 'Message copied.');
  };

  const statusColor = (value: string) => {
    if (['appointment_confirmed', 'closed'].includes(value)) return '#00dc85';
    if (['failed', 'opted_out'].includes(value)) return '#ff3348';
    if (['replied', 'appointment_requested'].includes(value)) return '#9d5fff';
    if (['sent', 'delivered', 'manual_sent'].includes(value)) return '#00b8f5';
    if (value === 'no_response') return '#ff8c00';
    return '#ffbe00';
  };

  const smallButton = (color: string) => ({
    background: `${color}22`, border: `1px solid ${color}`, borderRadius: 8,
    padding: '7px 9px', color, fontWeight: 800, cursor: 'pointer', fontSize: 10,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {notice && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1200, maxWidth: 390, background: '#0b1830', border: '1px solid #00b8f5', borderRadius: 10, padding: '11px 14px', color: '#dce8ff', boxShadow: '0 10px 30px #0008', fontSize: 12 }}>
          {notice}
        </div>
      )}

      <div style={{ background: C.card, border: '1px solid #162e58', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: C.text }}>
              📲 {es ? 'Recuperación de clientes' : 'Customer Recovery Queue'}
            </div>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>
              {es
                ? 'Recupera trabajos Customer Not Home, No Access o Appointment Required.'
                : 'Recover Customer Not Home, No Access and Appointment Required jobs.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: C.dim, fontSize: 11 }}>
              {es ? 'Cargados' : 'Loaded'}: {rows.length}
            </span>
            <button onClick={load} style={{ background: '#00b8f522', border: '1px solid #00b8f5', borderRadius: 9, color: '#00b8f5', padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>
              ↻ {es ? 'Actualizar' : 'Refresh'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14, background: '#071327', border: '1px solid #00dc8555', borderRadius: 11, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: '#00dc85', marginBottom: 5 }}>● {es ? 'SMS manual activado' : 'Manual SMS enabled'}</div>
          <div style={{ fontSize: 10, color: C.dim }}>{es ? 'Abre Messages y utiliza el plan telefónico del técnico. El técnico debe presionar Send y luego marcar el mensaje como enviado.' : 'Opens Messages and uses the technician phone plan. The technician must press Send and then mark the message as sent.'}</div>
          <div style={{ fontSize: 10, color: '#ffbe00', marginTop: 7 }}>⚠️ {es ? 'Abrir el compositor no confirma el envío ni la entrega.' : 'Opening the composer does not prove sending or delivery.'}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginTop: 14 }}>
          {[
            { label: es ? 'Total' : 'Total', value: rows.length, color: '#00b8f5' },
            { label: es ? 'En cola' : 'Queued', value: rows.filter((r) => ['queued', 'manual_draft_opened'].includes(r.status)).length, color: '#ffbe00' },
            { label: es ? 'SMS manual' : 'Manual sent', value: rows.filter((r) => r.status === 'manual_sent').length, color: '#00b8f5' },
            { label: es ? 'Respondidos' : 'Replied', value: rows.filter((r) => ['replied', 'appointment_requested'].includes(r.status)).length, color: '#9d5fff' },
            { label: es ? 'Citas' : 'Appointments', value: rows.filter((r) => r.status === 'appointment_confirmed').length, color: '#00dc85' },
          ].map((card) => (
            <div key={card.label} style={{ background: '#0e1e3a', border: `1px solid ${card.color}44`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: card.color }}>{card.value}</div>
              <div style={{ fontSize: 10, color: C.dim }}>{card.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginTop: 12 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={es ? 'Job, dirección, técnico o teléfono...' : 'Job, address, tech or phone...'} style={{ background: '#071327', border: '1px solid #162e58', borderRadius: 9, padding: '10px 12px', color: C.text, outline: 'none' }} />
          <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ background: '#071327', border: '1px solid #162e58', borderRadius: 9, padding: '10px 12px', color: C.text, outline: 'none' }}>
            <option value="all">{es ? 'Todos' : 'All'}</option>
            <option value="queued">Queued</option>
            <option value="manual_draft_opened">Manual draft opened</option>
            <option value="manual_sent">Manual sent</option>
            <option value="replied">Replied</option>
            <option value="appointment_requested">Appointment requested</option>
            <option value="appointment_confirmed">Appointment confirmed</option>
            <option value="no_response">No response</option>
            <option value="opted_out">Opted out</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30, color: C.dim }}>{es ? 'Cargando...' : 'Loading...'}</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: C.card, border: '1px solid #162e58', borderRadius: 14, padding: 32, textAlign: 'center', color: C.dim }}>
          {es ? 'No hay trabajos de recuperación.' : 'No customer recovery jobs.'}
        </div>
      ) : (
        filtered.map((row) => {
          const color = statusColor(row.status);
          const optedOut = row.status === 'opted_out';
          return (
            <div key={row.id} style={{ background: C.card, border: `1px solid ${color}44`, borderRadius: 12, padding: '13px 15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, color: '#00b8f5' }}>#{row.job_id}</span>
                    <span style={{ background: `${color}22`, border: `1px solid ${color}55`, borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 800, color }}>{String(row.status || 'queued').replaceAll('_', ' ').toUpperCase()}</span>
                    <span style={{ fontSize: 11, color: C.dim }}>👷 {row.tech_name || row.tech_id}</span>
                    <span style={{ fontSize: 9, color: '#8da4c9', border: '1px solid #294a80', borderRadius: 12, padding: '2px 6px' }}>{row.contact_method || 'manual_sms'}</span>
                  </div>
                  <div style={{ marginTop: 5, color: C.text, fontSize: 13, fontWeight: 700 }}>{row.address || '—'}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5, color: C.dim, fontSize: 11 }}>
                    <span>📞 {row.customer_phone || 'No phone'}</span>
                    <span>⚠️ {row.original_reason || '—'}</span>
                    <span>🕒 {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</span>
                  </div>
                  {row.manual_sent_at && <div style={{ marginTop: 5, color: '#00b8f5', fontSize: 10 }}>✅ {es ? 'Marcado enviado por' : 'Marked sent by'} {row.manual_sent_by || 'user'} · {new Date(row.manual_sent_at).toLocaleString()}</div>}
                  {row.latest_reply && <div style={{ marginTop: 8, background: '#0e1e3a', borderRadius: 8, padding: '7px 9px', color: '#c8d8f4', fontSize: 11 }}>💬 {row.latest_reply}</div>}
                  {optedOut && <div style={{ marginTop: 7, color: '#ff6677', fontSize: 10, fontWeight: 800 }}>🚫 {es ? 'No enviar más mensajes a este cliente.' : 'Do not send additional messages to this customer.'}</div>}
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignContent: 'flex-start', maxWidth: 430 }}>
                  <button disabled={optedOut} onClick={() => sendUsingConfiguredMode(row)} style={{ ...smallButton('#00b8f5'), opacity: optedOut ? .4 : 1 }}>{es ? 'Abrir SMS' : 'Open SMS'}</button>
                  <button disabled={optedOut} onClick={() => copyMessage(row)} style={{ ...smallButton('#8da4c9'), opacity: optedOut ? .4 : 1 }}>{es ? 'Copiar' : 'Copy'}</button>
                  <button disabled={optedOut} onClick={() => confirmManualSent(row)} style={{ ...smallButton('#00dc85'), opacity: optedOut ? .4 : 1 }}>{es ? 'Marcar enviado' : 'Mark sent'}</button>
                  <button onClick={() => { setSelected(row); setDialog('reply'); setReplyText(''); }} style={smallButton('#9d5fff')}>{es ? 'Registrar respuesta' : 'Record reply'}</button>
                  <button onClick={() => noResponse(row)} style={smallButton('#ff8c00')}>{es ? 'Sin respuesta' : 'No response'}</button>
                  <button onClick={() => window.open(`tel:${String(row.customer_phone || '').replace(/\D/g, '')}`, '_self')} style={smallButton('#00dc85')}>{es ? 'Llamar' : 'Call'}</button>
                  <button onClick={() => { setSelected(row); setDialog('appointment'); }} style={smallButton('#c39dff')}>{es ? 'Cita' : 'Appointment'}</button>
                  <button onClick={() => setRowStatus(row, 'closed')} style={smallButton('#8da4c9')}>{es ? 'Cerrar' : 'Close'}</button>
                </div>
              </div>
            </div>
          );
        })
      )}

      {!loading && hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          style={{
            alignSelf: 'center',
            background: loadingMore ? '#24395f' : '#00b8f522',
            border: '1px solid #00b8f5',
            borderRadius: 10,
            color: '#00b8f5',
            padding: '10px 18px',
            fontWeight: 900,
            cursor: loadingMore ? 'default' : 'pointer',
          }}
        >
          {loadingMore ? (es ? 'Cargando...' : 'Loading...') : (es ? 'Cargar más' : 'Load more')}
        </button>
      )}

      {selected && dialog === 'reply' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.86)', zIndex: 990, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div style={{ width: '100%', maxWidth: 470, background: '#0b1830', border: '1px solid #9d5fff66', borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, color: '#c39dff' }}>{es ? 'Registrar respuesta del cliente' : 'Record customer reply'}</div>
            <div style={{ color: C.dim, fontSize: 12, margin: '5px 0 12px' }}>#{selected.job_id} · {selected.address}</div>
            <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder={es ? 'Copia o escribe exactamente la respuesta recibida...' : 'Paste or type the exact response received...'} style={{ width: '100%', boxSizing: 'border-box', minHeight: 120, background: '#071327', border: '1px solid #294a80', borderRadius: 9, padding: 11, color: C.text, resize: 'vertical' }} />
            <div style={{ marginTop: 8, color: C.dim, fontSize: 10 }}>{es ? 'La app detectará 1, 2, Today, Tomorrow y STOP. Toda interpretación requiere revisión humana.' : 'The app detects 1, 2, Today, Tomorrow and STOP. All interpretation requires human review.'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={closeDialog} style={{ flex: 1, background: 'none', border: '1px solid #162e58', borderRadius: 9, padding: 10, color: C.dim, cursor: 'pointer' }}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button disabled={!replyText.trim()} onClick={submitReply} style={{ flex: 1, background: replyText.trim() ? '#9d5fff' : '#2e4470', border: 'none', borderRadius: 9, padding: 10, color: '#fff', fontWeight: 900, cursor: replyText.trim() ? 'pointer' : 'default' }}>{es ? 'Guardar respuesta' : 'Save reply'}</button>
            </div>
          </div>
        </div>
      )}

      {selected && dialog === 'appointment' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.86)', zIndex: 990, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div style={{ width: '100%', maxWidth: 430, background: '#0b1830', border: '1px solid #9d5fff66', borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, color: '#c39dff' }}>{es ? 'Crear cita de regreso' : 'Create return appointment'}</div>
            <div style={{ color: C.dim, fontSize: 12, margin: '5px 0 14px' }}>#{selected.job_id} · {selected.address}</div>
            <label style={{ color: C.dim, fontSize: 10, display: 'block', marginBottom: 4 }}>{es ? 'Fecha' : 'Date'}</label>
            <input type="date" value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: '#071327', border: '1px solid #162e58', borderRadius: 9, padding: 10, color: C.text, marginBottom: 10 }} />
            <label style={{ color: C.dim, fontSize: 10, display: 'block', marginBottom: 4 }}>{es ? 'Ventana de horario' : 'Time window'}</label>
            <input value={appointmentWindow} onChange={(event) => setAppointmentWindow(event.target.value)} placeholder="1:00 PM - 4:00 PM" style={{ width: '100%', boxSizing: 'border-box', background: '#071327', border: '1px solid #162e58', borderRadius: 9, padding: 10, color: C.text, marginBottom: 14 }} />
            <div style={{ background: '#071327', borderRadius: 9, padding: 10, color: C.dim, fontSize: 10, marginBottom: 14 }}>{getCustomerRecoveryMessage(selected.language || 'en')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={closeDialog} style={{ flex: 1, background: 'none', border: '1px solid #162e58', borderRadius: 9, padding: 10, color: C.dim, cursor: 'pointer' }}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button disabled={!appointmentDate} onClick={() => setRowStatus(selected, 'appointment_confirmed', { appointment_date: appointmentDate, appointment_window: appointmentWindow })} style={{ flex: 1, background: appointmentDate ? '#9d5fff' : '#2e4470', border: 'none', borderRadius: 9, padding: 10, color: '#fff', fontWeight: 900, cursor: appointmentDate ? 'pointer' : 'default' }}>{es ? 'Confirmar cita' : 'Confirm appointment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
