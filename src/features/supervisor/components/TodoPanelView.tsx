// GUAJIRO V25.10 — Panel de Seguimiento (To-Do con notas, fotos y prioridad)
/* =============================================================================
 * TodoPanelView.tsx
 * -----------------------------------------------------------------------------
 * Tab 'todo' del SupervisorPortal (#/sup/<region>/todo) + botón 📌 para mandar
 * un job al panel desde Not Done Pool y desde Dispatch.
 *
 * Storage: IndexedDB propia `gfs-todo-panel` (v1), store `todo_items`.
 *   NO usa `gfs-local-operations` a propósito: localRitStore.service.ts abre esa
 *   base con DB_VERSION fijo en 1, así que agregarle un store obligaría a subir
 *   la versión y cualquier open(…, 1) posterior fallaría con VersionError —
 *   es decir, rompería el not_done_pool local. Base aparte = cero riesgo.
 *
 * Fotos: browser-image-compression (misma dependencia que usa el técnico, ya
 * maneja HEIC/HEIF del iPhone), guardadas como data URL dentro de la tarea.
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import imageCompression from 'browser-image-compression';
import { C } from '../../../config/theme';

/* =============================================================================
 * SECCIÓN 1 — Tipos y constantes
 * ========================================================================== */

type TodoPriority = 'high' | 'med' | 'low';
type TodoSourceType = 'manual' | 'route' | 'notdone';

type TodoPhoto = {
  id: string;
  dataUrl: string;
  name: string;
  addedAt: number;
};

type TodoItem = {
  id: string;
  region: string;
  title: string;
  notes: string;
  dueDate: string;          // 'YYYY-MM-DD' o '' sin fecha
  priority: TodoPriority;
  done: boolean;
  order: number;            // menor = más arriba
  createdAt: number;
  completedAt: number | null;
  photos: TodoPhoto[];
  sourceType: TodoSourceType;
  sourceKey: string;        // para no duplicar el mismo job
};

const DB_NAME = 'gfs-todo-panel';
const DB_VERSION = 1;
const STORE = 'todo_items';
const MAX_PHOTOS = 8;
const TODO_EVENT = 'gfs-todo-changed';
const FALLBACK_KEY = 'gfs_todo_items_fallback';

const PRIORITY_COLOR: Record<TodoPriority, string> = {
  high: C.red,
  med: C.yellow,
  low: C.green,
};

const PRIORITY_TEXT: Record<TodoPriority, { es: string; en: string }> = {
  high: { es: 'Alta', en: 'High' },
  med: { es: 'Media', en: 'Medium' },
  low: { es: 'Baja', en: 'Low' },
};

/** Fila de job proveniente de Dispatch o Not Done Pool (esquemas distintos). */
type JobLike = Record<string, unknown>;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
}

/** Fecha local YYYY-MM-DD (toISOString corre un día con UTC-4/-5). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDayStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dueInfo(due: string, es: boolean): { text: string; overdue: boolean; today: boolean } {
  if (!due) return { text: '', overdue: false, today: false };
  if (due === todayStr()) return { text: es ? 'Hoy' : 'Today', overdue: false, today: true };
  if (due === shiftDayStr(1)) return { text: es ? 'Mañana' : 'Tomorrow', overdue: false, today: false };
  const [y, m, d] = due.split('-').map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / 86400000);
  const short = `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  if (diff < 0) return { text: `${short} · ${es ? 'vencida' : 'overdue'} ${Math.abs(diff)}d`, overdue: true, today: false };
  return { text: short, overdue: false, today: false };
}

/* =============================================================================
 * SECCIÓN 2 — Storage (IndexedDB con fallback a localStorage)
 * ========================================================================== */

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let settled = false;
    const done = (v: IDBDatabase | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try { db.close(); } catch { /* noop */ } dbPromise = null; };
        done(db);
      };
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
    } catch { done(null); }
  });
  return dbPromise;
}

function fallbackRead(): TodoItem[] {
  try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]'); } catch { return []; }
}

function fallbackWrite(rows: TodoItem[]) {
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(rows)); } catch { /* cuota llena: se pierde, no rompe */ }
}

async function storeGetAll(): Promise<TodoItem[]> {
  const db = await openDb();
  if (!db) return fallbackRead();
  return new Promise<TodoItem[]>((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as TodoItem[]);
      req.onerror = () => resolve(fallbackRead());
    } catch { resolve(fallbackRead()); }
  });
}

async function storePut(rows: TodoItem[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  if (!db) {
    const current = fallbackRead();
    const byId = new Map(current.map((r) => [r.id, r]));
    rows.forEach((r) => byId.set(r.id, r));
    fallbackWrite(Array.from(byId.values()));
    return;
  }
  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      rows.forEach((r) => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

async function storeDelete(id: string): Promise<void> {
  const db = await openDb();
  if (!db) { fallbackWrite(fallbackRead().filter((r) => r.id !== id)); return; }
  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

function notifyChanged() {
  try { window.dispatchEvent(new CustomEvent(TODO_EVENT)); } catch { /* noop */ }
}

/* =============================================================================
 * SECCIÓN 3 — Compresión de fotos
 * ========================================================================== */

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

/** ~150 KB máx, 1280px lado mayor, JPEG. Mismos parámetros que el módulo del técnico. */
async function compressToDataUrl(file: File): Promise<string> {
  let out: Blob = file;
  try {
    out = await imageCompression(file, {
      maxSizeMB: 0.15,
      maxWidthOrHeight: 1280,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: 0.7,
    });
  } catch {
    out = file; // si falla la compresión guardo el original antes que perder la foto
  }
  return fileToDataUrl(out);
}

/* =============================================================================
 * SECCIÓN 4 — Job -> tarea
 * -----------------------------------------------------------------------------
 * Not Done Pool usa job_id / address / city / latest_technician_id.
 * Dispatch usa job_id / address / city / tech_id.
 * Si aparece otra vista con nombres distintos, se agregan a estas listas.
 * ========================================================================== */

const JOB_NUMBER_KEYS = ['job_id', 'job_number', 'jobNumber', 'job', 'work_order', 'wo'];
const ADDRESS_KEYS = ['address', 'full_address', 'service_address', 'direccion'];
const CITY_KEYS = ['city', 'zone', 'municipality'];
const TECH_KEYS = ['tech_name', 'latest_technician_id', 'tech_id', 'technician_id', 'assigned_to'];
const REASON_KEYS = ['latest_reason', 'original_reason', 'reason'];
const TYPE_KEYS = ['type', 'job_type', 'inferred_category'];

function pickField(obj: JobLike, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function jobToTodo(job: JobLike, es: boolean): { title: string; key: string; notes: string } {
  const num = pickField(job, JOB_NUMBER_KEYS);
  const addr = pickField(job, ADDRESS_KEYS);
  const city = pickField(job, CITY_KEYS);
  const tech = pickField(job, TECH_KEYS);
  const reason = pickField(job, REASON_KEYS);
  const type = pickField(job, TYPE_KEYS);
  const title = [num ? `#${num}` : '', addr].filter(Boolean).join(' · ') || (job?.id ? `Job ${job.id}` : 'Job');
  const key = (num || addr || String(job?.id || uid())).toLowerCase();
  const notes = [
    city ? `${es ? 'Ciudad' : 'City'}: ${city}` : '',
    tech ? `${es ? 'Técnico' : 'Tech'}: ${tech}` : '',
    reason ? `${es ? 'Motivo' : 'Reason'}: ${reason}` : '',
    type ? `${es ? 'Tipo' : 'Type'}: ${type}` : '',
  ].filter(Boolean).join('\n');
  return { title, key, notes };
}

async function addJobToTodo(job: JobLike, sourceType: TodoSourceType, region: string, es: boolean): Promise<'added' | 'duplicate'> {
  const { title, key, notes } = jobToTodo(job, es);
  const all = await storeGetAll();
  const sourceKey = `${sourceType}:${region}:${key}`;
  if (all.some((t) => !t.done && t.sourceKey === sourceKey)) return 'duplicate';
  const minOrder = all.length ? Math.min(...all.map((t) => t.order)) : 0;
  await storePut([{
    id: uid(),
    region,
    title,
    notes,
    dueDate: todayStr(),
    priority: 'med',
    done: false,
    order: minOrder - 1,
    createdAt: Date.now(),
    completedAt: null,
    photos: [],
    sourceType,
    sourceKey,
  }]);
  notifyChanged();
  return 'added';
}

/* =============================================================================
 * SECCIÓN 5 — Botón 📌 para las filas de Dispatch / Not Done Pool
 * ========================================================================== */

export function SendToTodoButton({ job, sourceType = 'manual', region = '', lang = 'es' }: {
  job: JobLike;
  sourceType?: TodoSourceType;
  region?: string;
  lang?: string;
}) {
  const es = lang === 'es';
  const [state, setState] = useState<'idle' | 'ok' | 'dup' | 'err'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const click = async (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const r = await addJobToTodo(job, sourceType, region, es);
      setState(r === 'added' ? 'ok' : 'dup');
    } catch { setState('err'); }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };

  const label = state === 'ok' ? (es ? '✓ Enviado' : '✓ Sent')
    : state === 'dup' ? (es ? '• Ya está' : '• Already')
      : state === 'err' ? (es ? '✕ Error' : '✕ Error')
        : '📌';
  const tone = state === 'ok' ? C.green : state === 'err' ? C.red : state === 'dup' ? C.dim : C.purple;

  return (
    <button
      type="button"
      onClick={click}
      title={es ? 'Enviar al panel de Seguimiento' : 'Send to Follow-up panel'}
      style={{ background: `${tone}22`, border: `1px solid ${tone}`, borderRadius: 7, padding: '7px 9px', color: tone, fontSize: 10, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {label}
    </button>
  );
}

/* =============================================================================
 * SECCIÓN 6 — Estilos del panel
 * ========================================================================== */

const ST: Record<string, CSSProperties> = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 },
  input: { background: C.card2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: "'Barlow',sans-serif" },
  btn: { background: '#0e1e3a', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  btnMain: { background: 'linear-gradient(135deg,#0040c0,#00b8f5)', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  chip: { background: '#0e1e3a', color: C.dim, border: `1px solid ${C.border}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' },
  label: { fontSize: 10, color: C.dim, marginBottom: 4, display: 'block', fontWeight: 700 },
};

/* =============================================================================
 * SECCIÓN 7 — Tarjeta de tarea
 * ========================================================================== */

function TaskCard({
  item, es, dragging, busyPhotos, canUp, canDown,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onPatch, onDelete, onMove, onAddPhotos, onRemovePhoto, onViewPhoto,
}: {
  item: TodoItem;
  es: boolean;
  dragging: boolean;
  busyPhotos: boolean;
  canUp: boolean;
  canDown: boolean;
  onDragStart: () => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onPatch: (patch: Partial<TodoItem>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddPhotos: (files: FileList | null) => void;
  onRemovePhoto: (photoId: string) => void;
  onViewPhoto: (photo: TodoPhoto) => void;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const due = dueInfo(item.dueDate, es);
  const color = PRIORITY_COLOR[item.priority];

  return (
    <div
      draggable={!item.done}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ ...ST.card, borderLeft: `5px solid ${color}`, opacity: dragging ? 0.4 : item.done ? 0.68 : 1, marginBottom: 8 }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => onPatch({ done: e.target.checked, completedAt: e.target.checked ? Date.now() : null })}
          title={es ? 'Marcar como completada' : 'Mark as done'}
          style={{ width: 20, height: 20, marginTop: 2, accentColor: C.green, flexShrink: 0, cursor: 'pointer' }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            onClick={() => setOpen((v) => !v)}
            style={{ fontSize: 14, fontWeight: 900, cursor: 'pointer', wordBreak: 'break-word', color: item.done ? C.dim : '#ffffff', textDecoration: item.done ? 'line-through' : 'none' }}
          >
            {item.title || (es ? '(sin título)' : '(untitled)')}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            {item.dueDate && (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 800,
                color: !item.done && due.overdue ? C.red : !item.done && due.today ? C.yellow : C.dim,
                border: `1px solid ${!item.done && due.overdue ? C.red : !item.done && due.today ? C.yellow : C.border}`,
                background: !item.done && due.overdue ? `${C.red}18` : 'transparent',
              }}>📅 {due.text}</span>
            )}
            {!item.done && (
              <select
                value={item.priority}
                onChange={(e) => onPatch({ priority: e.target.value as TodoPriority })}
                title={es ? 'Cambiar prioridad' : 'Change priority'}
                style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 20, background: `${color}18`, color, border: `1px solid ${color}`, cursor: 'pointer' }}
              >
                <option value="high">{es ? PRIORITY_TEXT.high.es : PRIORITY_TEXT.high.en}</option>
                <option value="med">{es ? PRIORITY_TEXT.med.es : PRIORITY_TEXT.med.en}</option>
                <option value="low">{es ? PRIORITY_TEXT.low.es : PRIORITY_TEXT.low.en}</option>
              </select>
            )}
            {item.photos.length > 0 && <span style={{ fontSize: 10, color: C.dim }}>📷 {item.photos.length}</span>}
            {item.notes.trim() !== '' && <span style={{ fontSize: 10, color: C.dim }}>📝</span>}
            {item.sourceType !== 'manual' && (
              <span style={{ fontSize: 9, color: C.muted, fontWeight: 800 }}>
                {item.sourceType === 'route' ? 'DISPATCH' : 'NOT DONE'}
              </span>
            )}
          </div>
        </div>

        {!item.done && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
            <button type="button" onClick={() => onMove(-1)} disabled={!canUp} title={es ? 'Subir' : 'Move up'} style={{ ...ST.btn, padding: '0 8px', opacity: canUp ? 1 : 0.25 }}>▲</button>
            <button type="button" onClick={() => onMove(1)} disabled={!canDown} title={es ? 'Bajar' : 'Move down'} style={{ ...ST.btn, padding: '0 8px', opacity: canDown ? 1 : 0.25 }}>▼</button>
          </div>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} title={es ? 'Detalles' : 'Details'} style={{ ...ST.btn, padding: '2px 9px', flexShrink: 0 }}>{open ? '▾' : '▸'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <label style={ST.label}>{es ? 'Título' : 'Title'}</label>
          <input style={{ ...ST.input, marginBottom: 8 }} value={item.title} onChange={(e) => onPatch({ title: e.target.value })} />

          <label style={ST.label}>{es ? 'Notas' : 'Notes'}</label>
          <textarea
            style={{ ...ST.input, minHeight: 74, resize: 'vertical', marginBottom: 8 }}
            value={item.notes}
            placeholder={es ? 'Detalles, qué falta, con quién hablaste...' : 'Details, what is pending, who you talked to...'}
            onChange={(e) => onPatch({ notes: e.target.value })}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={ST.label}>{es ? 'Fecha' : 'Date'}</label>
              <input type="date" style={ST.input} value={item.dueDate} onChange={(e) => onPatch({ dueDate: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label style={ST.label}>{es ? 'Prioridad' : 'Priority'}</label>
              <select style={{ ...ST.input, color, fontWeight: 800 }} value={item.priority} onChange={(e) => onPatch({ priority: e.target.value as TodoPriority })}>
                <option value="high">{es ? PRIORITY_TEXT.high.es : PRIORITY_TEXT.high.en}</option>
                <option value="med">{es ? PRIORITY_TEXT.med.es : PRIORITY_TEXT.med.en}</option>
                <option value="low">{es ? PRIORITY_TEXT.low.es : PRIORITY_TEXT.low.en}</option>
              </select>
            </div>
          </div>

          <label style={ST.label}>{es ? 'Fotos' : 'Photos'} ({item.photos.length}/{MAX_PHOTOS})</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {item.photos.map((p) => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img
                  src={p.dataUrl}
                  alt={p.name}
                  onClick={() => onViewPhoto(p)}
                  style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'zoom-in', display: 'block' }}
                />
                <button
                  type="button"
                  onClick={() => onRemovePhoto(p.id)}
                  title={es ? 'Quitar foto' : 'Remove photo'}
                  style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', background: '#2a0d12', color: C.red, border: `1px solid ${C.red}`, cursor: 'pointer', fontSize: 12, lineHeight: '19px', padding: 0, fontWeight: 900 }}
                >×</button>
              </div>
            ))}
            {item.photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busyPhotos}
                title={es ? 'Agregar fotos' : 'Add photos'}
                style={{ width: 74, height: 74, borderRadius: 8, border: `1px dashed ${C.muted}`, background: C.card2, color: C.dim, cursor: busyPhotos ? 'wait' : 'pointer', fontSize: busyPhotos ? 11 : 22, fontWeight: 700 }}
              >{busyPhotos ? '…' : '＋'}</button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { onAddPhotos(e.target.files); e.target.value = ''; }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: C.muted }}>
              {es ? 'Creada' : 'Created'} {new Date(item.createdAt).toLocaleDateString()}
              {item.completedAt ? ` · ${es ? 'completada' : 'done'} ${new Date(item.completedAt).toLocaleDateString()}` : ''}
            </span>
            <button type="button" onClick={onDelete} style={{ ...ST.btn, background: `${C.red}18`, borderColor: C.red, color: C.red }}>
              🗑 {es ? 'Eliminar' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =============================================================================
 * SECCIÓN 8 — Panel principal
 * ========================================================================== */

type FilterKey = 'all' | 'today' | 'overdue' | 'high';

export default function TodoPanelView({ lang = 'es', region = '' }: { lang?: string; region?: string }) {
  const es = lang === 'es';

  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [viewer, setViewer] = useState<TodoPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState<string>('');

  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(todayStr());
  const [newPriority, setNewPriority] = useState<TodoPriority>('med');

  const [dragId, setDragId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await storeGetAll();
      const mine = all.filter((t) => !t.region || !region || t.region === region);
      mine.sort((a, b) => a.order - b.order || b.createdAt - a.createdAt);
      setItems(mine);
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    reload();
    const onChanged = () => reload();
    window.addEventListener(TODO_EVENT, onChanged);
    return () => window.removeEventListener(TODO_EVENT, onChanged);
  }, [reload]);

  /* --- mutaciones -------------------------------------------------------- */

  const patch = useCallback((id: string, p: Partial<TodoItem>) => {
    setItems((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...p } : t));
      const target = next.find((t) => t.id === id);
      if (target) storePut([target]).catch((e) => setError(errText(e)));
      return next;
    });
  }, []);

  const removeItem = useCallback(async (id: string) => {
    if (!window.confirm(es ? '¿Eliminar esta tarea?' : 'Delete this task?')) return;
    setItems((prev) => prev.filter((t) => t.id !== id));
    try { await storeDelete(id); } catch (e) { setError(errText(e)); }
  }, [es]);

  const addTask = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const minOrder = items.length ? Math.min(...items.map((t) => t.order)) : 0;
    const item: TodoItem = {
      id: uid(),
      region,
      title,
      notes: '',
      dueDate: newDate,
      priority: newPriority,
      done: false,
      order: minOrder - 1,
      createdAt: Date.now(),
      completedAt: null,
      photos: [],
      sourceType: 'manual',
      sourceKey: `manual:${uid()}`,
    };
    setItems((prev) => [item, ...prev]);
    setNewTitle('');
    setNewPriority('med');
    setNewDate(todayStr());
    try { await storePut([item]); } catch (e) { setError(errText(e)); }
  }, [newTitle, newDate, newPriority, items, region]);

  const addPhotos = useCallback(async (id: string, files: FileList | null) => {
    if (!files || !files.length) return;
    const current = items.find((t) => t.id === id);
    if (!current) return;
    const room = MAX_PHOTOS - current.photos.length;
    if (room <= 0) return;
    setPhotoBusy(id);
    const added: TodoPhoto[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      if (f.type && !f.type.startsWith('image/')) continue;
      try {
        added.push({ id: uid(), dataUrl: await compressToDataUrl(f), name: f.name || 'foto.jpg', addedAt: Date.now() });
      } catch { /* si una falla, sigo con las demás */ }
    }
    setPhotoBusy('');
    if (!added.length) { setError(es ? 'No se pudo procesar ninguna foto.' : 'No photo could be processed.'); return; }
    const updated = { ...current, photos: [...current.photos, ...added] };
    setItems((prev) => prev.map((t) => (t.id === id ? updated : t)));
    try { await storePut([updated]); } catch (e) { setError(errText(e)); }
  }, [items, es]);

  const removePhoto = useCallback(async (id: string, photoId: string) => {
    const current = items.find((t) => t.id === id);
    if (!current) return;
    const updated = { ...current, photos: current.photos.filter((p) => p.id !== photoId) };
    setItems((prev) => prev.map((t) => (t.id === id ? updated : t)));
    try { await storePut([updated]); } catch (e) { setError(errText(e)); }
  }, [items]);

  /* --- orden ------------------------------------------------------------- */

  const pending = useMemo(() => items.filter((t) => !t.done), [items]);
  const completed = useMemo(() => items.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)), [items]);

  const persistOrder = useCallback(async (ordered: TodoItem[]) => {
    const renumbered = ordered.map((t, i) => ({ ...t, order: i }));
    setItems((prev) => {
      const byId = new Map(renumbered.map((t) => [t.id, t]));
      return prev.map((t) => byId.get(t.id) || t).sort((a, b) => a.order - b.order || b.createdAt - a.createdAt);
    });
    try { await storePut(renumbered); } catch (e) { setError(errText(e)); }
  }, []);

  const moveBy = useCallback((id: string, dir: -1 | 1) => {
    const idx = pending.findIndex((t) => t.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= pending.length) return;
    const next = pending.slice();
    const [row] = next.splice(idx, 1);
    next.splice(target, 0, row);
    persistOrder(next);
  }, [pending, persistOrder]);

  const dropOn = useCallback((targetId: string) => {
    const from = pending.findIndex((t) => t.id === dragId);
    const to = pending.findIndex((t) => t.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = pending.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    persistOrder(next);
  }, [dragId, pending, persistOrder]);

  /* --- filtros ----------------------------------------------------------- */

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const t = todayStr();
    return pending.filter((it) => {
      if (q && !`${it.title} ${it.notes}`.toLowerCase().includes(q)) return false;
      if (filter === 'today') return it.dueDate === t;
      if (filter === 'overdue') return Boolean(it.dueDate) && it.dueDate < t;
      if (filter === 'high') return it.priority === 'high';
      return true;
    });
  }, [pending, filter, search]);

  const overdueCount = useMemo(() => {
    const t = todayStr();
    return pending.filter((it) => it.dueDate && it.dueDate < t).length;
  }, [pending]);

  const FILTERS: { k: FilterKey; es: string; en: string }[] = [
    { k: 'all', es: 'Todas', en: 'All' },
    { k: 'today', es: 'Hoy', en: 'Today' },
    { k: 'overdue', es: 'Vencidas', en: 'Overdue' },
    { k: 'high', es: 'Alta', en: 'High' },
  ];

  /* --- render ------------------------------------------------------------ */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'linear-gradient(135deg,#0a1e40,#071428)', border: '1px solid #1e3560', borderRadius: 16, padding: '20px 22px' }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 900, color: C.text }}>
          📋 {es ? 'Seguimiento' : 'Follow-up'}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
          {pending.length} {es ? 'pendientes' : 'pending'}
          {overdueCount > 0 && <span style={{ color: C.red, fontWeight: 800 }}> · {overdueCount} {es ? 'vencidas' : 'overdue'}</span>}
          {completed.length > 0 && <> · {completed.length} {es ? 'completadas' : 'done'}</>}
        </div>
      </div>

      {/* alta rápida */}
      <div style={ST.card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ ...ST.input, flex: '2 1 240px', width: 'auto' }}
            placeholder={es ? 'Nueva tarea...' : 'New task...'}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
          />
          <input type="date" style={{ ...ST.input, flex: '1 1 140px', width: 'auto' }} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <select
            style={{ ...ST.input, flex: '0 1 120px', width: 'auto', color: PRIORITY_COLOR[newPriority], fontWeight: 800 }}
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as TodoPriority)}
          >
            <option value="high">{es ? PRIORITY_TEXT.high.es : PRIORITY_TEXT.high.en}</option>
            <option value="med">{es ? PRIORITY_TEXT.med.es : PRIORITY_TEXT.med.en}</option>
            <option value="low">{es ? PRIORITY_TEXT.low.es : PRIORITY_TEXT.low.en}</option>
          </select>
          <button type="button" style={ST.btnMain} onClick={addTask}>{es ? 'Agregar' : 'Add'}</button>
        </div>
      </div>

      {/* filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            style={{ ...ST.chip, background: filter === f.k ? `${C.accent}22` : '#0e1e3a', color: filter === f.k ? C.accent : C.dim, borderColor: filter === f.k ? C.accent : C.border }}
          >{es ? f.es : f.en}</button>
        ))}
        <input
          style={{ ...ST.input, flex: '1 1 160px', width: 'auto', padding: '6px 10px', fontSize: 12 }}
          placeholder={es ? 'Buscar...' : 'Search...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error !== '' && (
        <div style={{ ...ST.card, borderColor: C.red, background: `${C.red}12`, color: C.red, fontSize: 12, fontWeight: 700 }}>⚠ {error}</div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.6 }}>
          {pending.length === 0
            ? (es ? 'Sin tareas pendientes. Agrega una arriba, o manda un trabajo con 📌 desde Pool Pendientes o Despacho.'
              : 'No pending tasks. Add one above, or send a job with 📌 from Past Pending Pool or Dispatch.')
            : (es ? 'Ninguna tarea coincide con el filtro.' : 'No tasks match the filter.')}
        </div>
      ) : (
        <div>
          {visible.map((it, i) => (
            <TaskCard
              key={it.id}
              item={it}
              es={es}
              dragging={dragId === it.id}
              busyPhotos={photoBusy === it.id}
              canUp={i > 0}
              canDown={i < visible.length - 1}
              onDragStart={() => setDragId(it.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(it.id)}
              onDragEnd={() => setDragId(null)}
              onPatch={(p) => patch(it.id, p)}
              onDelete={() => removeItem(it.id)}
              onMove={(d) => moveBy(it.id, d)}
              onAddPhotos={(f) => addPhotos(it.id, f)}
              onRemovePhoto={(pid) => removePhoto(it.id, pid)}
              onViewPhoto={setViewer}
            />
          ))}
        </div>
      )}

      {/* completadas */}
      {completed.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDone((v) => !v)} style={{ ...ST.btn, width: '100%', textAlign: 'left', padding: '10px 12px' }}>
            {showDone ? '▾' : '▸'} {es ? 'Completadas' : 'Completed'} ({completed.length})
          </button>
          {showDone && (
            <div style={{ marginTop: 8 }}>
              {completed.map((it) => (
                <TaskCard
                  key={it.id}
                  item={it}
                  es={es}
                  dragging={false}
                  busyPhotos={photoBusy === it.id}
                  canUp={false}
                  canDown={false}
                  onDragStart={() => { /* completadas no se arrastran */ }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { /* noop */ }}
                  onDragEnd={() => { /* noop */ }}
                  onPatch={(p) => patch(it.id, p)}
                  onDelete={() => removeItem(it.id)}
                  onMove={() => { /* noop */ }}
                  onAddPhotos={(f) => addPhotos(it.id, f)}
                  onRemovePhoto={(pid) => removePhoto(it.id, pid)}
                  onViewPhoto={setViewer}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6 }}>
        {es
          ? 'Las tareas se guardan en este dispositivo (IndexedDB). No se sincronizan entre el celular y la laptop.'
          : 'Tasks are stored on this device (IndexedDB). They do not sync between phone and laptop.'}
      </div>

      {/* visor de foto */}
      {viewer && (
        <div
          onClick={() => setViewer(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <img src={viewer.dataUrl} alt={viewer.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
          <button type="button" onClick={() => setViewer(null)} style={{ ...ST.btn, position: 'absolute', top: 14, right: 14 }}>✕</button>
        </div>
      )}
    </div>
  );
}
