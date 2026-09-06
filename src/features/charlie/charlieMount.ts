import { GATE_ACCESS_TEMPLATE, buildPhoneList, buildSmsLink, getRouteMessageTargets } from '../../services/customerMessages.service';

type CharliePriority = 'ok' | 'watch' | 'hot';

type CharlieInsight = {
  id: string;
  title: string;
  count: number;
  priority: CharliePriority;
  detail: string;
  action: string;
  sms: string;
};

type CharliePattern = {
  id: string;
  title: string;
  words: string[];
  detail: string;
  action: string;
  sms: string;
};

type CharlieSnapshot = {
  text: string;
  rows: Record<string, any>[];
  localKeys: number;
  bytes: number;
  source: string;
};

const DB_NAME = 'gfs-local-operations';
const NOT_DONE_STORE = 'not_done_pool';
const NOT_DONE_FALLBACK_KEY = 'gfs_local_store_not_done_pool';

const SENSITIVE_KEY_WORDS = ['charlie', 'auth', 'supabase', 'token', 'pin'];

const CHARLIE_PATTERNS: CharliePattern[] = [
  {
    id: 'access',
    title: 'Access / Gate',
    words: ['access', 'gate', 'locked', 'no access', 'fence', 'dog', 'hoa'],
    detail: 'Jobs may fail if the technician arrives without access instructions.',
    action: 'Verify gate code, access window, dog/HOA restrictions and customer confirmation before routing.',
    sms: 'Hello, this is Comcast/Xfinity field operations. We need to confirm access before sending the technician. Please reply with gate code, access instructions, and the best time window today.'
  },
  {
    id: '811',
    title: '811 / Locate',
    words: ['811', 'locate', 'marking', 'utility', 'marked', 'unmarked'],
    detail: 'Possible locate/utility risk detected.',
    action: 'Do not route until locate status is confirmed. Keep the job in Not Done / Past Pending until locate status is clear.',
    sms: 'Hello, this is Comcast/Xfinity field operations. Your work may require utility locate confirmation. We are checking the status before scheduling the technician.'
  },
  {
    id: 'missile',
    title: 'Missile / Bore',
    words: ['missile', 'bore', 'boring', 'underground', 'driveway', 'road bore'],
    detail: 'Underground-capable technician or special equipment may be required.',
    action: 'Assign only to a technician/equipment group prepared for bore or missile work.',
    sms: 'Hello, this is Comcast/Xfinity field operations. Your job may require underground/bore work. We are reviewing equipment and technician availability before scheduling.'
  },
  {
    id: 'materials',
    title: 'Materials',
    words: ['material', 'conduit', 'drop', 'cable', 'splice', 'pedestal', 'tap', 'inventory'],
    detail: 'Material issue detected in Not Done / Past Pending.',
    action: 'Check material availability before dispatch. Do not send technician without required items.',
    sms: 'Hello, this is Comcast/Xfinity field operations. We are checking material availability for your job and will update you with the next available appointment.'
  },
  {
    id: 'customer_absent',
    title: 'Customer Not Home',
    words: ['absent', 'not home', 'no answer', 'customer not home', 'no contact', 'no one home'],
    detail: 'Customer absent or no-contact pattern detected.',
    action: 'Send recovery message and offer same-day or next-day return window before routing again.',
    sms: 'A Comcast/Xfinity field technician visited your property today but could not access the work area or reach anyone. We need to schedule a return visit. Reply 1 for today, 2 for tomorrow, or send the date and time that works best. Reply STOP to opt out.'
  },
  {
    id: 'damage_risk',
    title: 'Damage / Safety Risk',
    words: ['damage', 'broken', 'unsafe', 'hazard', 'danger', 'angry', 'complaint'],
    detail: 'Risk or customer escalation wording detected.',
    action: 'Supervisor must review before dispatch. Add notes and keep trace/audit record.',
    sms: 'Hello, this is Comcast/Xfinity field operations. A supervisor is reviewing your job notes so we can schedule the correct follow-up safely.'
  },
  {
    id: 'weather',
    title: 'Weather Hold',
    words: ['storm', 'thunderstorm', 'lightning', 'rain', 'flood', 'severe'],
    detail: 'Weather wording found. Charlie will not recommend alerts unless official severe criteria are confirmed.',
    action: 'Use Weather Alert Control. Do not send severe alert from normal rain or non-official storm wording.',
    sms: 'Hello, this is Comcast/Xfinity field operations. Weather may affect today’s route. We will update you if the appointment window changes.'
  }
];

let activeTab = 'today';
let lastInsights: CharlieInsight[] = [];
let lastSnapshot: CharlieSnapshot = { text: '', rows: [], localKeys: 0, bytes: 0, source: 'not scanned' };
let lastScanAt = '';
let scanInProgress = false;

function storageGet(key: string, fallback: string): string {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be blocked in some browser modes. Charlie still works visually.
  }
}

function isSensitiveLocalKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_WORDS.some((word) => lower.includes(word));
}

function safeJsonArray(value: string): Record<string, any>[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function rowToSearchText(row: Record<string, any>): string {
  const pieces = [
    row.job_id,
    row.address,
    row.city,
    row.current_status,
    row.latest_reason,
    row.original_reason,
    row.latest_notes,
    row.notes,
    row.resolution_notes,
    row.work_type,
    row.latest_technician_id,
    row.source_technician_id,
  ];
  return pieces.map((value) => String(value ?? '')).join(' ').toLowerCase();
}

async function indexedDbExists(name: string): Promise<boolean> {
  try {
    const databasesFn = (indexedDB as any).databases;
    if (typeof databasesFn !== 'function') return false;
    const databases = await databasesFn.call(indexedDB);
    return Array.isArray(databases) && databases.some((db: any) => db?.name === name);
  } catch {
    return false;
  }
}

async function readNotDonePoolFromIndexedDb(): Promise<Record<string, any>[] | null> {
  if (typeof indexedDB === 'undefined') return null;
  const exists = await indexedDbExists(DB_NAME);
  if (!exists) return null;

  return new Promise((resolve) => {
    let done = false;
    const settle = (rows: Record<string, any>[] | null) => {
      if (done) return;
      done = true;
      resolve(rows);
    };

    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      try { request.transaction?.abort(); } catch {}
      settle(null);
    };
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOT_DONE_STORE)) {
        db.close();
        settle(null);
        return;
      }
      try {
        const tx = db.transaction(NOT_DONE_STORE, 'readonly');
        const getAll = tx.objectStore(NOT_DONE_STORE).getAll();
        getAll.onsuccess = () => {
          const rows = Array.isArray(getAll.result) ? getAll.result : [];
          db.close();
          settle(rows.filter((item) => item && typeof item === 'object'));
        };
        getAll.onerror = () => {
          db.close();
          settle(null);
        };
      } catch {
        db.close();
        settle(null);
      }
    };
  });
}

function readNotDonePoolFromFallbackStorage(): Record<string, any>[] {
  return safeJsonArray(storageGet(NOT_DONE_FALLBACK_KEY, '[]'));
}

function readSafeLocalStorageText(): { text: string; keys: number; bytes: number } {
  try {
    const parts: string[] = [];
    let totalBytes = 0;
    let keyCount = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) || '';
      if (!key || isSensitiveLocalKey(key)) continue;
      const value = window.localStorage.getItem(key) || '';
      parts.push(key + ': ' + value);
      totalBytes += key.length + value.length;
      keyCount += 1;
    }
    return { text: parts.join(' ').toLowerCase(), keys: keyCount, bytes: totalBytes };
  } catch {
    return { text: '', keys: 0, bytes: 0 };
  }
}

async function readCharlieSnapshot(): Promise<CharlieSnapshot> {
  const safeLocal = readSafeLocalStorageText();
  const indexedRows = await readNotDonePoolFromIndexedDb();
  if (indexedRows && indexedRows.length) {
    const rowText = indexedRows.map(rowToSearchText).join(' ');
    return {
      text: `${rowText} ${safeLocal.text}`.trim(),
      rows: indexedRows,
      localKeys: safeLocal.keys,
      bytes: safeLocal.bytes + rowText.length,
      source: 'IndexedDB gfs-local-operations/not_done_pool',
    };
  }

  const fallbackRows = readNotDonePoolFromFallbackStorage();
  if (fallbackRows.length) {
    const rowText = fallbackRows.map(rowToSearchText).join(' ');
    return {
      text: `${rowText} ${safeLocal.text}`.trim(),
      rows: fallbackRows,
      localKeys: safeLocal.keys,
      bytes: safeLocal.bytes + rowText.length,
      source: 'localStorage gfs_local_store_not_done_pool',
    };
  }

  return {
    text: safeLocal.text,
    rows: [],
    localKeys: safeLocal.keys,
    bytes: safeLocal.bytes,
    source: 'safe localStorage scan only',
  };
}

function countMatches(text: string, words: string[]): number {
  let count = 0;
  for (let index = 0; index < words.length; index += 1) {
    if (text.indexOf(words[index].toLowerCase()) >= 0) count += 1;
  }
  return count;
}

function countMatchingRows(rows: Record<string, any>[], words: string[]): number {
  let count = 0;
  for (let index = 0; index < rows.length; index += 1) {
    if (countMatches(rowToSearchText(rows[index]), words) > 0) count += 1;
  }
  return count;
}

async function scanInsights(): Promise<CharlieInsight[]> {
  scanInProgress = true;
  lastSnapshot = await readCharlieSnapshot();
  const insights: CharlieInsight[] = [];

  for (let index = 0; index < CHARLIE_PATTERNS.length; index += 1) {
    const pattern = CHARLIE_PATTERNS[index];
    const count = lastSnapshot.rows.length > 0
      ? countMatchingRows(lastSnapshot.rows, pattern.words)
      : countMatches(lastSnapshot.text, pattern.words);
    if (count > 0) {
      insights.push({
        id: pattern.id,
        title: pattern.title,
        count,
        priority: count >= 2 ? 'hot' : 'watch',
        detail: pattern.detail,
        action: pattern.action,
        sms: pattern.sms
      });
    }
  }

  insights.sort((a, b) => b.count - a.count);
  if (insights.length === 0) {
    insights.push({
      id: 'ready',
      title: 'Charlie is ready',
      count: 0,
      priority: 'ok',
      detail: 'No strong Not Done / Past Pending pattern detected yet. Open or load the real Not Done Pool so Charlie can read more local PWA data.',
      action: 'Start with Route, Not Done Pool, Dispatch and History. Charlie reads the real local Not Done Pool when it exists.',
      sms: 'Hello, this is Comcast/Xfinity field operations. We are reviewing your job and will contact you with the next available appointment.'
    });
  }

  lastInsights = insights;
  lastScanAt = new Date().toLocaleString();
  storageSet('gfs_charlie_last_scan', lastScanAt);
  scanInProgress = false;
  return insights;
}

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

function priorityLabel(priority: CharliePriority): string {
  if (priority === 'hot') return 'High';
  if (priority === 'watch') return 'Watch';
  return 'OK';
}

function renderInsightCards(insights: CharlieInsight[]): string {
  return insights.map((insight) => {
    return `
      <article class="gfs-charlie-card ${insight.priority}">
        <div class="gfs-charlie-card-head">
          <strong>${escapeHtml(insight.title)}</strong>
          <span>${priorityLabel(insight.priority)} · ${insight.count}</span>
        </div>
        <p>${escapeHtml(insight.detail)}</p>
        <div class="gfs-charlie-action-text">${escapeHtml(insight.action)}</div>
        <div class="gfs-charlie-mini-actions">
          <button data-charlie-action="copy-sms" data-id="${escapeHtml(insight.id)}">Copy SMS</button>
          <button data-charlie-action="problem-job" data-id="${escapeHtml(insight.id)}">Open Not Done Pool</button>
        </div>
      </article>
    `;
  }).join('');
}

function buildFollowUpPlan(insights: CharlieInsight[]): string {
  const actionable = insights.filter((item) => item.id !== 'ready');
  if (actionable.length === 0) {
    return '1. Import or load today route.\n2. Open Not Done / Past Pending Pool.\n3. Open Search / History.\n4. Click Scan again in Charlie.\n5. Charlie will then build a follow-up plan from the real local Not Done Pool.';
  }

  const lines = [
    'Charlie Follow-up Plan',
    'Generated: ' + new Date().toLocaleString(),
    'Source: ' + lastSnapshot.source,
    'Not Done rows read: ' + lastSnapshot.rows.length,
    '',
    'Priority order:'
  ];

  for (let index = 0; index < actionable.length; index += 1) {
    const item = actionable[index];
    lines.push((index + 1) + '. ' + item.title + ' (' + item.count + ') — ' + item.action);
  }

  lines.push('', 'Supervisor checklist:');
  lines.push('- Keep unclear jobs in Not Done / Past Pending before building tomorrow route.');
  lines.push('- Confirm access/811/materials before technician dispatch.');
  lines.push('- Keep resolved jobs green and leave comments for audit trace.');
  lines.push('- Do not trigger weather severe alerts unless official severe alert criteria are active.');
  return lines.join('\n');
}

function getInsightById(id: string): CharlieInsight | null {
  for (let index = 0; index < lastInsights.length; index += 1) {
    if (lastInsights[index].id === id) return lastInsights[index];
  }
  return null;
}

function queueProblemJob(insight: CharlieInsight): void {
  const existing = storageGet('gfs_charlie_problem_job_queue', '[]');
  let list: Array<{ id: string; title: string; action: string; createdAt: string }> = [];
  try {
    const parsed = JSON.parse(existing);
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = [];
  }
  list.unshift({ id: insight.id, title: insight.title, action: insight.action, createdAt: new Date().toISOString() });
  storageSet('gfs_charlie_problem_job_queue', JSON.stringify(list.slice(0, 50)));
}

function copyText(text: string): void {
  const setStatus = (message: string) => {
    const status = document.getElementById('gfs-charlie-status');
    if (status) status.textContent = message;
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => setStatus('Copied.')).catch(() => setStatus('Could not copy automatically. Text is shown in Notes.'));
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      setStatus('Copied.');
    }
  } catch {
    setStatus('Could not copy automatically.');
  }
}

function parseCurrentHash(): { role: string; region: string; tab: string } {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'sup') return { role: 'supervisor', region: parts[1] || readStoredRegion(), tab: parts[2] || 'dashboard' };
  if (parts[0] === 'tech') return { role: 'tech', region: readStoredRegion(), tab: parts[2] || 'route' };
  return { role: '', region: readStoredRegion(), tab: '' };
}

function readStoredRegion(): string {
  const candidates = [storageGet('gfs_auth', ''), (() => { try { return window.sessionStorage.getItem('gfs_auth') || ''; } catch { return ''; } })()];
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      const parsed = candidates[index] ? JSON.parse(candidates[index]) : null;
      if (parsed?.region) return String(parsed.region);
    } catch {}
  }
  return 'miami';
}

function supervisorHash(tab: string): string {
  const current = parseCurrentHash();
  return `#/sup/${current.region || readStoredRegion()}/${tab}`;
}

function navigateToSupervisorTab(tab: string): void {
  const oldURL = window.location.href;
  const hash = supervisorHash(tab);
  window.history.replaceState({ gfsInAppNavigation: true }, '', hash);
  try {
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: `${window.location.origin}${window.location.pathname}${hash}` }));
  } catch {
    window.dispatchEvent(new Event('hashchange'));
  }
}

function openModule(name: string): void {
  const lower = name.toLowerCase();
  if (lower.includes('problem') || lower.includes('notdone') || lower.includes('not done')) {
    navigateToSupervisorTab('notdone_pool');
    return;
  }
  if (lower.includes('dispatch')) {
    navigateToSupervisorTab('dispatch');
    return;
  }
  if (lower.includes('search') || lower.includes('history')) {
    navigateToSupervisorTab('search');
    return;
  }
  navigateToSupervisorTab('dashboard');
}

function tabButton(id: string, label: string): string {
  return `<button class="${activeTab === id ? 'active' : ''}" data-charlie-tab="${id}">${label}</button>`;
}

function renderToday(insights: CharlieInsight[]): string {
  return `
    <div class="gfs-charlie-summary-grid">
      <div><strong>${lastSnapshot.rows.length}</strong><span>not done rows</span></div>
      <div><strong>${insights.filter((item) => item.id !== 'ready').length}</strong><span>signals</span></div>
      <div><strong>${Math.round(lastSnapshot.bytes / 1024)}</strong><span>KB read</span></div>
    </div>
    <div class="gfs-charlie-source">Source: ${escapeHtml(lastSnapshot.source)}</div>
    ${renderInsightCards(insights)}
  `;
}

function renderActions(insights: CharlieInsight[]): string {
  const plan = buildFollowUpPlan(insights);
  return `
    <div class="gfs-charlie-plan-box"><pre>${escapeHtml(plan)}</pre></div>
    <div class="gfs-charlie-big-actions">
      <button data-charlie-action="copy-plan">Copy follow-up plan</button>
      <button data-charlie-action="save-plan">Save plan locally</button>
      <button data-charlie-action="tomorrow-route">Suggest tomorrow route review</button>
      <button data-charlie-action="open-problems">Open Not Done Pool</button>
      <button data-charlie-action="open-dispatch">Open Dispatch</button>
      <button data-charlie-action="open-search">Open Search</button>
    </div>
  `;
}

function renderMessages(insights: CharlieInsight[]): string {
  // V25.2 — Customer gate-access message (EN+ES in one message) with
  // per-customer one-tap SMS links built from today's cached route.
  const route = getRouteMessageTargets();
  const smsButtons = route.targets.slice(0, 60).map((t) => `
    <a href="${buildSmsLink(t.phone)}" style="display:inline-block;border-radius:10px;background:#1d4ed8;color:#fff;padding:7px 9px;font-weight:900;font-size:12px;text-decoration:none;margin:3px 3px 0 0">📱 #${escapeHtml(t.jobId)}${t.techId ? ' · T' + escapeHtml(t.techId) : ''}</a>
  `).join('');
  const gateCard = `
    <article class="gfs-charlie-message-card">
      <strong>🔑 Gate / Access Code — whole route (${route.targets.length} customers${route.date ? ' · ' + escapeHtml(route.date) : ''})</strong>
      <textarea id="gfs-charlie-gate-msg">${escapeHtml(GATE_ACCESS_TEMPLATE)}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <button data-charlie-action="copy-gate-msg">Copy message</button>
        <button data-charlie-action="copy-gate-phones">Copy ${route.targets.length} phone numbers</button>
      </div>
      ${route.skippedNoPhone ? `<p style="margin:8px 0 0;color:#b45309;font-size:12px">⚠ ${route.skippedNoPhone} jobs without a valid phone were skipped.</p>` : ''}
      <p style="margin:8px 0 4px;color:#64748b;font-size:12px">Tap to open your SMS app with the message ready (one tap per customer). Replies arrive to YOUR phone — auto-forwarding replies as a note on each technician's job needs Twilio (planned V26).</p>
      <div>${smsButtons || '<span style="color:#64748b;font-size:12px">No route with phone numbers found in the local cache. Open the Route tab first.</span>'}</div>
    </article>
  `;
  const cards = insights.map((insight) => `
    <article class="gfs-charlie-message-card">
      <strong>${escapeHtml(insight.title)}</strong>
      <textarea readonly>${escapeHtml(insight.sms)}</textarea>
      <button data-charlie-action="copy-sms" data-id="${escapeHtml(insight.id)}">Copy this message</button>
    </article>
  `).join('');
  return gateCard + cards;
}

function renderNotes(): string {
  const notes = storageGet('gfs_charlie_notes', '');
  return `
    <p class="gfs-charlie-help">Use this space for supervisor notes, problem-job decisions, next-day route strategy or reminders.</p>
    <textarea id="gfs-charlie-notes">${escapeHtml(notes)}</textarea>
    <div class="gfs-charlie-big-actions">
      <button data-charlie-action="save-notes">Save notes</button>
      <button data-charlie-action="clear-notes">Clear notes</button>
    </div>
  `;
}

function renderSettings(): string {
  const startOpen = storageGet('gfs_charlie_start_open', 'no');
  return `
    <div class="gfs-charlie-settings">
      <label><input type="checkbox" id="gfs-charlie-start-open" ${startOpen === 'yes' ? 'checked' : ''}> Open Charlie automatically</label>
      <label><input type="checkbox" id="gfs-charlie-compact" ${storageGet('gfs_charlie_compact', 'no') === 'yes' ? 'checked' : ''}> Compact mode</label>
      <p>Charlie reads the real local Not Done Pool from IndexedDB when available, then falls back to ${NOT_DONE_FALLBACK_KEY}. It ignores local keys containing charlie/auth/supabase/token/pin.</p>
    </div>
  `;
}

function renderPanel(): void {
  const results = document.getElementById('gfs-charlie-ai-results');
  if (!results) return;

  let body = '';
  if (scanInProgress && lastInsights.length === 0) {
    body = '<div class="gfs-charlie-loading">Scanning real Not Done Pool...</div>';
  } else if (activeTab === 'today') body = renderToday(lastInsights);
  else if (activeTab === 'actions') body = renderActions(lastInsights);
  else if (activeTab === 'messages') body = renderMessages(lastInsights);
  else if (activeTab === 'notes') body = renderNotes();
  else if (activeTab === 'settings') body = renderSettings();

  results.innerHTML = `
    <div class="gfs-charlie-tabs">
      ${tabButton('today', 'Today')}
      ${tabButton('actions', 'Actions')}
      ${tabButton('messages', 'Messages')}
      ${tabButton('notes', 'Notes')}
      ${tabButton('settings', 'Settings')}
    </div>
    <div class="gfs-charlie-tab-body">${body}</div>
  `;
  wirePanelEvents();
}

async function runScan(nextTab?: string): Promise<void> {
  if (nextTab) activeTab = nextTab;
  const status = document.getElementById('gfs-charlie-status');
  if (status) status.textContent = 'Scanning real Not Done Pool...';
  renderPanel();
  await scanInsights();
  renderPanel();
  if (status) status.textContent = 'Last scan: ' + lastScanAt + ' · ' + lastSnapshot.source;
}

function wirePanelEvents(): void {
  const tabButtons = document.querySelectorAll('[data-charlie-tab]');
  for (let index = 0; index < tabButtons.length; index += 1) {
    tabButtons[index].addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLElement;
      activeTab = target.getAttribute('data-charlie-tab') || 'today';
      renderPanel();
    });
  }

  const actionButtons = document.querySelectorAll('[data-charlie-action]');
  for (let index = 0; index < actionButtons.length; index += 1) {
    actionButtons[index].addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLElement;
      const action = target.getAttribute('data-charlie-action') || '';
      const id = target.getAttribute('data-id') || '';
      const insight = getInsightById(id) || lastInsights[0];
      const status = document.getElementById('gfs-charlie-status');

      if (action === 'copy-sms' && insight) copyText(insight.sms);
      if (action === 'copy-gate-msg') {
        const box = document.getElementById('gfs-charlie-gate-msg') as HTMLTextAreaElement | null;
        copyText(box?.value || GATE_ACCESS_TEMPLATE);
        if (status) status.textContent = 'Gate access message copied.';
      }
      if (action === 'copy-gate-phones') {
        copyText(buildPhoneList(getRouteMessageTargets().targets));
        if (status) status.textContent = 'Route phone list copied.';
      }
      if (action === 'problem-job' && insight) {
        queueProblemJob(insight);
        openModule('problem');
        if (status) status.textContent = insight.title + ' queued locally. Opened Not Done Pool.';
      }
      if (action === 'copy-plan') copyText(buildFollowUpPlan(lastInsights));
      if (action === 'save-plan') {
        storageSet('gfs_charlie_follow_up_plan', buildFollowUpPlan(lastInsights));
        if (status) status.textContent = 'Follow-up plan saved locally.';
      }
      if (action === 'tomorrow-route') {
        const plan = buildFollowUpPlan(lastInsights) + '\n\nTomorrow route review: prioritize resolved access, verified 811, materials ready, and closest technician capability.';
        storageSet('gfs_charlie_tomorrow_route_suggestion', plan);
        if (status) status.textContent = 'Tomorrow route suggestion saved locally.';
      }
      if (action === 'open-problems') openModule('problem');
      if (action === 'open-dispatch') openModule('dispatch');
      if (action === 'open-search') openModule('search');
      if (action === 'save-notes') {
        const notes = document.getElementById('gfs-charlie-notes') as HTMLTextAreaElement | null;
        storageSet('gfs_charlie_notes', notes ? notes.value : '');
        if (status) status.textContent = 'Notes saved.';
      }
      if (action === 'clear-notes') {
        storageSet('gfs_charlie_notes', '');
        renderPanel();
      }
    });
  }

  const startOpen = document.getElementById('gfs-charlie-start-open') as HTMLInputElement | null;
  if (startOpen) {
    startOpen.addEventListener('change', () => storageSet('gfs_charlie_start_open', startOpen.checked ? 'yes' : 'no'));
  }
  const compact = document.getElementById('gfs-charlie-compact') as HTMLInputElement | null;
  if (compact) {
    compact.addEventListener('change', () => {
      storageSet('gfs_charlie_compact', compact.checked ? 'yes' : 'no');
      const panel = document.getElementById('gfs-charlie-ai-panel');
      if (panel) panel.classList.toggle('compact', compact.checked);
    });
  }
}

function ensureCharlieMounted(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gfs-charlie-ai-root')) return;

  const style = document.createElement('style');
  style.textContent = `
    #gfs-charlie-ai-root{position:fixed;left:14px;right:auto;bottom:16px;z-index:520;font-family:Inter,Arial,sans-serif;color:#0f172a;touch-action:none}/* V25.2: draggable, position persisted in gfs_charlie_pos */
    #gfs-charlie-ai-button{border:1px solid rgba(255,255,255,.2);border-radius:999px;background:linear-gradient(135deg,#111827,#1d4ed8);color:white;padding:13px 18px;font-weight:900;box-shadow:0 14px 38px rgba(15,23,42,.36);cursor:grab;font-size:15px;letter-spacing:.1px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
    #gfs-charlie-ai-button .badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;margin-left:8px;border-radius:999px;background:#22c55e;color:#052e16;font-size:11px;font-weight:900}
    #gfs-charlie-ai-panel{display:none;position:absolute;left:0;right:auto;bottom:60px;width:min(460px,calc(100vw - 26px));max-height:min(720px,calc(100vh - 105px));overflow:auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:20px;box-shadow:0 24px 70px rgba(15,23,42,.32);padding:0}
    #gfs-charlie-ai-panel.open{display:block}
    #gfs-charlie-ai-panel.compact{width:min(380px,calc(100vw - 26px))}
    .gfs-charlie-header{position:sticky;top:0;background:linear-gradient(135deg,#f8fafc,#eff6ff);border-bottom:1px solid #e2e8f0;padding:14px 16px;z-index:1;border-radius:20px 20px 0 0}
    .gfs-charlie-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .gfs-charlie-title-row h2{margin:0;font-size:20px;color:#0f172a}.gfs-charlie-title-row button{border:0;background:#e2e8f0;border-radius:999px;width:30px;height:30px;cursor:pointer;font-weight:900;color:#0f172a}
    .gfs-charlie-sub{margin:5px 0 0;color:#475569;font-size:13px;line-height:1.35}.gfs-charlie-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.gfs-charlie-toolbar button{border:0;border-radius:12px;background:#2563eb;color:white;padding:10px 11px;font-weight:900;cursor:pointer}.gfs-charlie-toolbar button.secondary{background:#0f172a}
    #gfs-charlie-status{font-size:12px;color:#64748b;margin-top:8px;min-height:16px}.gfs-charlie-tabs{display:flex;gap:6px;overflow:auto;padding:12px 14px 0}.gfs-charlie-tabs button{border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap}.gfs-charlie-tabs button.active{background:#0f172a;color:white;border-color:#0f172a}
    .gfs-charlie-tab-body{padding:12px 14px 16px}.gfs-charlie-summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}.gfs-charlie-summary-grid div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:10px;text-align:center}.gfs-charlie-summary-grid strong{display:block;color:#0f172a;font-size:19px}.gfs-charlie-summary-grid span{display:block;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}.gfs-charlie-source{font-size:11px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;margin-bottom:10px}.gfs-charlie-loading{padding:26px;text-align:center;color:#64748b;font-weight:900}
    .gfs-charlie-card,.gfs-charlie-message-card{border:1px solid #e2e8f0;background:#f8fafc;border-radius:15px;padding:12px;margin:10px 0}.gfs-charlie-card.hot{border-color:#fb923c;background:#fff7ed}.gfs-charlie-card.watch{border-color:#93c5fd;background:#eff6ff}.gfs-charlie-card.ok{border-color:#86efac;background:#f0fdf4}.gfs-charlie-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.gfs-charlie-card-head strong{color:#0f172a}.gfs-charlie-card-head span{border-radius:999px;background:white;border:1px solid #cbd5e1;padding:3px 7px;font-size:11px;font-weight:900;color:#334155}.gfs-charlie-card p{margin:8px 0 0;color:#475569;font-size:13px;line-height:1.35}.gfs-charlie-action-text{margin-top:8px;color:#0f172a;font-size:13px;font-weight:800}.gfs-charlie-mini-actions,.gfs-charlie-big-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.gfs-charlie-mini-actions button,.gfs-charlie-big-actions button,.gfs-charlie-message-card button{border:0;border-radius:11px;background:#1d4ed8;color:#fff;padding:9px 10px;font-weight:900;cursor:pointer}.gfs-charlie-mini-actions button:last-child{background:#111827}.gfs-charlie-plan-box pre{white-space:pre-wrap;margin:0;background:#0f172a;color:#e5e7eb;padding:12px;border-radius:14px;font-family:Consolas,monospace;font-size:12px;line-height:1.4}.gfs-charlie-message-card strong{display:block;margin-bottom:8px}.gfs-charlie-message-card textarea,#gfs-charlie-notes{width:100%;min-height:82px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:12px;padding:10px;font-family:Inter,Arial,sans-serif;color:#0f172a;background:white;resize:vertical}#gfs-charlie-notes{min-height:190px}.gfs-charlie-help,.gfs-charlie-settings p{color:#64748b;font-size:13px;line-height:1.4}.gfs-charlie-settings label{display:block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin:8px 0;color:#0f172a;font-weight:800}
    @media(max-width:680px){#gfs-charlie-ai-root{left:10px;right:auto;bottom:96px;z-index:520}#gfs-charlie-ai-button{padding:10px 12px;font-size:12px}#gfs-charlie-ai-panel{left:0;right:auto;bottom:54px}.gfs-charlie-toolbar,.gfs-charlie-big-actions,.gfs-charlie-mini-actions{grid-template-columns:1fr}}
  `;

  const root = document.createElement('div');
  root.id = 'gfs-charlie-ai-root';
  const startOpen = storageGet('gfs_charlie_start_open', 'no') === 'yes';
  root.innerHTML = `
    <div id="gfs-charlie-ai-panel" class="${startOpen ? 'open' : ''} ${storageGet('gfs_charlie_compact', 'no') === 'yes' ? 'compact' : ''}" aria-live="polite">
      <div class="gfs-charlie-header">
        <div class="gfs-charlie-title-row">
          <h2>🤖 Charlie AI</h2>
          <button id="gfs-charlie-close" type="button" aria-label="Close Charlie">×</button>
        </div>
        <p class="gfs-charlie-sub">Interactive Field Ops Brain for the real Not Done Pool, 811, access, materials, weather control and next-day routing.</p>
        <div class="gfs-charlie-toolbar">
          <button id="gfs-charlie-scan" type="button">Scan real pool</button>
          <button id="gfs-charlie-plan" class="secondary" type="button">Generate plan</button>
        </div>
        <div id="gfs-charlie-status">Last scan: ${escapeHtml(storageGet('gfs_charlie_last_scan', 'not yet'))}</div>
      </div>
      <div id="gfs-charlie-ai-results"></div>
    </div>
    <button id="gfs-charlie-ai-button" type="button" aria-label="Open Charlie AI">🤖 Charlie AI <span class="badge">AI</span></button>
  `;

  document.head.appendChild(style);
  document.body.appendChild(root);
  renderPanel();
  void runScan('today');

  const button = document.getElementById('gfs-charlie-ai-button');
  const panel = document.getElementById('gfs-charlie-ai-panel');
  const close = document.getElementById('gfs-charlie-close');
  const scan = document.getElementById('gfs-charlie-scan');
  const plan = document.getElementById('gfs-charlie-plan');

  // V25.3 — draggable launcher (rewritten): window-level listeners during
  // the drag + pointercancel handling, so it works reliably on touch too.
  const charlieRoot = document.getElementById('gfs-charlie-ai-root');
  try {
    const saved = JSON.parse(storageGet('gfs_charlie_pos', '') || 'null');
    if (charlieRoot && saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      charlieRoot.style.left = Math.min(Math.max(saved.x, 4), window.innerWidth - 70) + 'px';
      charlieRoot.style.bottom = Math.min(Math.max(saved.y, 4), window.innerHeight - 70) + 'px';
    }
  } catch { /* keep default position */ }
  let dragMoved = false;
  if (button && charlieRoot) {
    let startX = 0; let startY = 0; let baseLeft = 0; let baseBottom = 0; let dragging = false;
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - startX; const dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) dragMoved = true;
      if (!dragMoved) return;
      event.preventDefault();
      const x = Math.min(Math.max(baseLeft + dx, 4), window.innerWidth - 70);
      const y = Math.min(Math.max(baseBottom - dy, 4), window.innerHeight - 70);
      charlieRoot.style.left = x + 'px';
      charlieRoot.style.bottom = y + 'px';
    };
    const onUp = () => {
      if (dragging && dragMoved) {
        storageSet('gfs_charlie_pos', JSON.stringify({ x: parseFloat(charlieRoot.style.left) || 14, y: parseFloat(charlieRoot.style.bottom) || 16 }));
      }
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    button.addEventListener('pointerdown', (event: PointerEvent) => {
      dragging = true; dragMoved = false;
      startX = event.clientX; startY = event.clientY;
      const rect = charlieRoot.getBoundingClientRect();
      baseLeft = rect.left;
      baseBottom = window.innerHeight - rect.bottom;
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }
  button?.addEventListener('click', () => {
    if (dragMoved) { dragMoved = false; return; } // a drag is not a click
    panel?.classList.toggle('open');
  });
  close?.addEventListener('click', () => panel?.classList.remove('open'));
  scan?.addEventListener('click', () => { void runScan('today'); });
  plan?.addEventListener('click', () => { void runScan('actions'); });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureCharlieMounted, { once: true });
  } else {
    ensureCharlieMounted();
  }
}

export { ensureCharlieMounted, scanInsights };
