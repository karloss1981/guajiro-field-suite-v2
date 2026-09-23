// ============================================================================
// SECCIÓN: PANEL DE PENDIENTES — Herramientas
// ----------------------------------------------------------------------------
// Bloque autocontenido para pegar dentro de App.tsx (donde vive el tab
// "Herramientas" del Supervisor Portal). Cubre:
//   1) To-do list / pendientes generales con calendario, notas y fotos
//   2) Notas/pendientes por técnico (usa la tabla `technicians` ya existente)
//   3) Marcar como realizado/no realizado + "X días pendiente"
//
// Tema oscuro incluido (v2) — ajustado para calzar con el look real de
// Guajiro & Sons (fondo navy, texto claro, acento azul). Si tus tonos
// exactos son distintos, cambia las constantes en `THEME` abajo y se
// propagan a todo el componente.
//
// AJUSTAR ANTES DE PEGAR:
//   - El import de `supabase` (usa el mismo cliente que ya usa el resto de
//     App.tsx, p.ej. `import { supabase } from './lib/supabase'`).
//   - `region` está fijado a 'miami'; si ya tienes una variable de región
//     activa en el Supervisor Portal, pásala como prop en vez del literal.
// ============================================================================

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { sb as supabase } from '../../../config/supabase';

// ----------------------------------------------------------------------------
// SECCIÓN: Tema (ajusta aquí si tus tonos exactos son distintos)
// ----------------------------------------------------------------------------

const THEME = {
  bg: 'transparent',
  card: '#141c30',
  cardBorder: '#26324a',
  cardBorderDashed: '#3a4a6b',
  textPrimary: '#e8ecf4',
  textSecondary: '#8b96ad',
  textMuted: '#5d6a85',
  accent: '#3b82f6',
  accentText: '#ffffff',
  inputBg: '#0c1424',
  inputBorder: '#2d3a56',
  danger: '#f87171',
  warn: '#fbbf24',
  ok: '#34d399',
};

// ----------------------------------------------------------------------------
// SECCIÓN: Tipos
// ----------------------------------------------------------------------------

type NoteKind = 'task' | 'tech_note';
type NoteStatus = 'pending' | 'done';

interface PanelNotePhoto {
  id: string;
  note_id: string;
  photo_url: string;
  thumb_url: string | null;
  created_at: string;
}

interface PanelNote {
  id: string;
  kind: NoteKind;
  tech_id: string | null;
  tech_name: string;
  title: string;
  content: string;
  status: NoteStatus;
  due_date: string | null;
  region: string;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  photos?: PanelNotePhoto[];
}

interface TechnicianLite {
  id: string;
  name: string;
}

// ----------------------------------------------------------------------------
// SECCIÓN: Utilidades
// ----------------------------------------------------------------------------

function diasPendiente(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - created) / 86400000));
}

function badgeColor(dias: number): string {
  if (dias >= 7) return THEME.danger;
  if (dias >= 3) return THEME.warn;
  return THEME.ok;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function comprimirFoto(file: File, maxDim = 1280, quality = 0.72): Promise<Blob> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo obtener contexto de canvas');
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Compresión falló'))),
      'image/jpeg',
      quality
    );
  });
}

// ----------------------------------------------------------------------------
// SECCIÓN: Data layer (Supabase)
// ----------------------------------------------------------------------------

async function fetchNotes(region: string): Promise<PanelNote[]> {
  const { data: notes, error } = await supabase
    .from('panel_notes')
    .select('*')
    .eq('region', region)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const ids = (notes ?? []).map((n) => n.id);
  let photosByNote: Record<string, PanelNotePhoto[]> = {};
  if (ids.length) {
    const { data: photos, error: pErr } = await supabase
      .from('panel_note_photos')
      .select('*')
      .in('note_id', ids);
    if (pErr) throw pErr;
    photosByNote = (photos ?? []).reduce((acc: Record<string, PanelNotePhoto[]>, p) => {
      (acc[p.note_id] ??= []).push(p);
      return acc;
    }, {});
  }

  return (notes ?? []).map((n) => ({ ...n, photos: photosByNote[n.id] ?? [] }));
}

async function fetchTechnicians(region: string): Promise<TechnicianLite[]> {
  const { data, error } = await supabase
    .from('technicians')
    .select('id, name')
    .eq('region', region)
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).filter((t) => t.id);
}

async function createNote(input: Partial<PanelNote> & { kind: NoteKind }): Promise<PanelNote> {
  const { data, error } = await supabase
    .from('panel_notes')
    .insert({
      kind: input.kind,
      tech_id: input.tech_id ?? null,
      tech_name: input.tech_name ?? '',
      title: input.title ?? '',
      content: input.content ?? '',
      due_date: input.due_date ?? null,
      region: input.region ?? 'miami',
    })
    .select('*')
    .single();
  if (error) throw error;
  return { ...data, photos: [] };
}

async function toggleNoteStatus(note: PanelNote): Promise<void> {
  const nextStatus: NoteStatus = note.status === 'pending' ? 'done' : 'pending';
  const { error } = await supabase
    .from('panel_notes')
    .update({
      status: nextStatus,
      completed_at: nextStatus === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', note.id);
  if (error) throw error;
}

async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase.from('panel_notes').delete().eq('id', noteId);
  if (error) throw error;
}

async function uploadNotePhoto(noteId: string, file: File): Promise<PanelNotePhoto> {
  const blob = await comprimirFoto(file);
  const path = `panel-notes/${noteId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
  const { error: upErr } = await supabase.storage.from('job-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from('job-photos').getPublicUrl(path);
  const { data, error } = await supabase
    .from('panel_note_photos')
    .insert({ note_id: noteId, photo_url: pub.publicUrl, storage_path: path })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// SECCIÓN: Estilos compartidos de formulario (inputs/textarea/botones)
// ----------------------------------------------------------------------------

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  marginBottom: 8,
  background: THEME.inputBg,
  border: `1px solid ${THEME.inputBorder}`,
  borderRadius: 6,
  color: THEME.textPrimary,
  fontSize: 14,
  boxSizing: 'border-box',
};

const buttonPrimary: CSSProperties = {
  background: THEME.accent,
  color: THEME.accentText,
  border: 'none',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const buttonGhost: CSSProperties = {
  background: 'transparent',
  border: `1px solid ${THEME.inputBorder}`,
  color: THEME.textSecondary,
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

// ----------------------------------------------------------------------------
// SECCIÓN: Mini calendario (sin dependencias externas)
// ----------------------------------------------------------------------------

function MiniCalendar({
  selected,
  onSelect,
  markedDates,
}: {
  selected: string;
  onSelect: (iso: string) => void;
  markedDates: Set<string>;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selected);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const monthLabel = cursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  return (
    <div style={{ border: `1px solid ${THEME.cardBorder}`, background: THEME.card, borderRadius: 10, padding: 12, maxWidth: 320 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Mes anterior" style={{ ...buttonGhost, padding: '2px 8px' }}>
          ‹
        </button>
        <strong style={{ textTransform: 'capitalize', color: THEME.textPrimary }}>{monthLabel}</strong>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Mes siguiente" style={{ ...buttonGhost, padding: '2px 8px' }}>
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, fontSize: 12 }}>
        {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', color: THEME.textMuted }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = iso === selected;
          const hasNotes = markedDates.has(iso);
          const isToday = iso === todayISO();
          return (
            <button
              key={i}
              onClick={() => onSelect(iso)}
              style={{
                position: 'relative',
                padding: '6px 0',
                borderRadius: 6,
                border: isToday && !isSelected ? `1px solid ${THEME.accent}` : '1px solid transparent',
                background: isSelected ? THEME.accent : 'transparent',
                color: isSelected ? THEME.accentText : THEME.textPrimary,
                cursor: 'pointer',
              }}
            >
              {day}
              {hasNotes && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: isSelected ? THEME.accentText : THEME.accent,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// SECCIÓN: Tarjeta de nota
// ----------------------------------------------------------------------------

function NoteCard({
  note,
  onToggle,
  onDelete,
  onAddPhoto,
}: {
  note: PanelNote;
  onToggle: (n: PanelNote) => void;
  onDelete: (id: string) => void;
  onAddPhoto: (id: string, file: File) => void;
}) {
  const dias = diasPendiente(note.created_at);
  const isDone = note.status === 'done';

  return (
    <div
      style={{
        border: `1px solid ${THEME.cardBorder}`,
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
        opacity: isDone ? 0.55 : 1,
        background: THEME.card,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          {note.kind === 'tech_note' && (
            <div style={{ fontSize: 12, color: THEME.textSecondary, marginBottom: 2 }}>
              Técnico: <strong style={{ color: THEME.textPrimary }}>{note.tech_name || note.tech_id}</strong>
            </div>
          )}
          {note.title && <div style={{ fontWeight: 600, color: THEME.textPrimary }}>{note.title}</div>}
          <div style={{ whiteSpace: 'pre-wrap', color: THEME.textPrimary, fontSize: 14 }}>{note.content}</div>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: THEME.textSecondary,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <input type="checkbox" checked={isDone} onChange={() => onToggle(note)} />
          {isDone ? 'Realizado' : 'Marcar hecho'}
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {!isDone && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: badgeColor(dias),
              border: `1px solid ${badgeColor(dias)}`,
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {dias === 0 ? 'Hoy' : `${dias} día${dias === 1 ? '' : 's'} pendiente`}
          </span>
        )}
        {note.due_date && (
          <span style={{ fontSize: 12, color: THEME.textSecondary }}>Programado: {note.due_date}</span>
        )}

        <label style={{ marginLeft: 'auto', fontSize: 12, color: THEME.accent, cursor: 'pointer' }}>
          + Foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAddPhoto(note.id, file);
              e.target.value = '';
            }}
          />
        </label>
        <button onClick={() => onDelete(note.id)} style={{ fontSize: 12, color: THEME.danger, border: 'none', background: 'none', cursor: 'pointer' }}>
          Eliminar
        </button>
      </div>

      {!!note.photos?.length && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {note.photos.map((p) => (
            <a key={p.id} href={p.photo_url} target="_blank" rel="noreferrer">
              <img
                src={p.thumb_url || p.photo_url}
                alt=""
                style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: `1px solid ${THEME.cardBorder}` }}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// SECCIÓN: Panel principal — export por defecto
// ----------------------------------------------------------------------------

export default function PanelPendientes({ region = 'miami' }: { region?: string }) {
  const [tab, setTab] = useState<'tareas' | 'tecnicos'>('tareas');
  const [notes, setNotes] = useState<PanelNote[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [showDoneToo, setShowDoneToo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newContent, setNewContent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [newTechId, setNewTechId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [n, t] = await Promise.all([fetchNotes(region), fetchTechnicians(region)]);
      setNotes(n);
      setTechnicians(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    reload();
  }, [reload]);

  const markedDates = useMemo(() => {
    const s = new Set<string>();
    notes.forEach((n) => {
      if (n.due_date) s.add(n.due_date);
    });
    return s;
  }, [notes]);

  const tareas = useMemo(
    () =>
      notes
        .filter((n) => n.kind === 'task')
        .filter((n) => showDoneToo || n.status === 'pending')
        .filter((n) => !n.due_date || n.due_date === selectedDate),
    [notes, showDoneToo, selectedDate]
  );

  const notasPorTecnico = useMemo(() => {
    const grouped: Record<string, PanelNote[]> = {};
    notes
      .filter((n) => n.kind === 'tech_note')
      .filter((n) => showDoneToo || n.status === 'pending')
      .forEach((n) => {
        const key = n.tech_id || 'sin-asignar';
        (grouped[key] ??= []).push(n);
      });
    return grouped;
  }, [notes, showDoneToo]);

  const handleToggle = async (note: PanelNote) => {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, status: n.status === 'pending' ? 'done' : 'pending' } : n)));
    try {
      await toggleNoteStatus(note);
    } catch {
      reload();
    }
  };

  const handleDelete = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteNote(id);
    } catch {
      reload();
    }
  };

  const handleAddPhoto = async (noteId: string, file: File) => {
    try {
      const photo = await uploadNotePhoto(noteId, file);
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, photos: [...(n.photos ?? []), photo] } : n)));
    } catch {
      reload();
    }
  };

  const handleCreateTask = async () => {
    if (!newContent.trim()) return;
    try {
      const created = await createNote({
        kind: 'task',
        title: newTitle.trim(),
        content: newContent.trim(),
        due_date: newDueDate || null,
        region,
      });
      setNotes((prev) => [created, ...prev]);
      setNewContent('');
      setNewTitle('');
      setNewDueDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateTechNote = async () => {
    if (!newContent.trim() || !newTechId) return;
    const tech = technicians.find((t) => t.id === newTechId);
    try {
      const created = await createNote({
        kind: 'tech_note',
        tech_id: newTechId,
        tech_name: tech?.name ?? '',
        content: newContent.trim(),
        region,
      });
      setNotes((prev) => [created, ...prev]);
      setNewContent('');
      setNewTechId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const tabButtonStyle = (active: boolean): CSSProperties => ({
    background: active ? THEME.accent : 'transparent',
    color: active ? THEME.accentText : THEME.textSecondary,
    border: active ? 'none' : `1px solid ${THEME.inputBorder}`,
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 14,
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
  });

  return (
    <div style={{ padding: 16, maxWidth: 900, background: THEME.bg, color: THEME.textPrimary }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <button onClick={() => setTab('tareas')} style={tabButtonStyle(tab === 'tareas')}>
          Pendientes
        </button>
        <button onClick={() => setTab('tecnicos')} style={tabButtonStyle(tab === 'tecnicos')}>
          Técnicos
        </button>
        <label style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, color: THEME.textSecondary }}>
          <input type="checkbox" checked={showDoneToo} onChange={(e) => setShowDoneToo(e.target.checked)} />
          Ver realizados
        </label>
      </div>

      {error && (
        <div style={{ color: THEME.danger, fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}
      {loading && <div style={{ color: THEME.textSecondary }}>Cargando…</div>}

      {!loading && tab === 'tareas' && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <MiniCalendar selected={selectedDate} onSelect={setSelectedDate} markedDates={markedDates} />

          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ border: `1px dashed ${THEME.cardBorderDashed}`, background: THEME.card, borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <input
                placeholder="Título (opcional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                style={inputStyle}
              />
              <textarea
                placeholder="¿Qué tienes pendiente?"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  style={{ ...inputStyle, width: 'auto', marginBottom: 0 }}
                />
                <button onClick={handleCreateTask} style={buttonPrimary}>
                  Agregar pendiente
                </button>
              </div>
            </div>

            {tareas.length === 0 && <div style={{ color: THEME.textMuted }}>Nada pendiente para este día.</div>}
            {tareas.map((n) => (
              <NoteCard key={n.id} note={n} onToggle={handleToggle} onDelete={handleDelete} onAddPhoto={handleAddPhoto} />
            ))}
          </div>
        </div>
      )}

      {!loading && tab === 'tecnicos' && (
        <div>
          <div style={{ border: `1px dashed ${THEME.cardBorderDashed}`, background: THEME.card, borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <select
              value={newTechId}
              onChange={(e) => setNewTechId(e.target.value)}
              style={inputStyle}
            >
              <option value="">Selecciona técnico…</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} — {t.name}
                </option>
              ))}
            </select>
            <textarea
              placeholder="Nota o pendiente sobre este técnico"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
            />
            <button onClick={handleCreateTechNote} style={buttonPrimary}>
              Agregar nota
            </button>
          </div>

          {technicians
            .filter((t) => notasPorTecnico[t.id]?.length)
            .map((t) => (
              <div key={t.id} style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: THEME.textPrimary }}>
                  {t.name} <span style={{ color: THEME.textMuted, fontWeight: 400 }}>({t.id})</span>
                </div>
                {notasPorTecnico[t.id].map((n) => (
                  <NoteCard key={n.id} note={n} onToggle={handleToggle} onDelete={handleDelete} onAddPhoto={handleAddPhoto} />
                ))}
              </div>
            ))}

          {Object.keys(notasPorTecnico).length === 0 && (
            <div style={{ color: THEME.textMuted }}>Sin notas de técnicos pendientes.</div>
          )}
        </div>
      )}
    </div>
  );
}
