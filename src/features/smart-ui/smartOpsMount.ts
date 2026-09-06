type SmartModule = {
  id: string;
  label: string;
  group: string;
  icon: string;
  clickText: string[];
  hash: string;
  description: string;
};

const SMART_MODULES: SmartModule[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Home', icon: '📊', clickText: ['dashboard'], hash: '#/sup/miami/dashboard', description: 'Daily overview, totals and supervisor status.' },
  { id: 'route', label: 'Today Route', group: 'Operations', icon: '📍', clickText: ['route'], hash: '#/sup/miami/route', description: 'Import, preview and manage today route.' },
  { id: 'notdone', label: 'Not Done Pool', group: 'Operations', icon: '🚨', clickText: ['past pending pool', 'not done', 'notdone'], hash: '#/sup/miami/notdone_pool', description: 'Pending, past pending and recovery jobs.' },
  { id: 'problems', label: 'Problem Jobs', group: 'Operations', icon: '🧩', clickText: ['problem jobs', 'problems', 'incidencias'], hash: '#/sup/miami/problem-jobs', description: 'Access, 811, missile, material and customer issues.' },
  { id: 'dispatch', label: 'Dispatch Board', group: 'Operations', icon: '🚚', clickText: ['dispatch'], hash: '#/sup/miami/dispatch', description: 'Assignment, technician capability and route decisions.' },
  { id: 'photos', label: 'Photo Sync Queue', group: 'Technician', icon: '📸', clickText: ['photo sync', 'photos'], hash: '#/sup/miami/photo-sync', description: 'Photo naming, compression and sync review.' },
  { id: 'history', label: 'History', group: 'Technician', icon: '🕘', clickText: ['history'], hash: '#/sup/miami/history', description: 'Past work, traces and completed job lookup.' },
  { id: 'control', label: 'Control Center', group: 'Control', icon: '🎛️', clickText: ['control center', 'control'], hash: '#/sup/miami/control-center', description: 'Supervisor control entry point.' },
  { id: 'full-control', label: 'Supervisor Full Control', group: 'Control', icon: '🛡️', clickText: ['supervisor full control', 'full control'], hash: '#/sup/miami/supervisor-full-control', description: 'Notes, add job, PIN, recovery, trace and control links.' },
  { id: 'audit', label: 'Audit Logs', group: 'Control', icon: '📋', clickText: ['audit logs', 'audit'], hash: '#/sup/miami/audit-logs', description: 'Action trace and user accountability.' },
  { id: 'recycle', label: 'Recycle Bin', group: 'Control', icon: '🗑️', clickText: ['recycle bin', 'recycle'], hash: '#/sup/miami/recycle-bin', description: 'Recovery area for deleted/removed records.' },
  { id: 'users', label: 'Users / Roles', group: 'Admin', icon: '👥', clickText: ['users roles', 'users / roles', 'roles'], hash: '#/sup/miami/users-roles', description: 'Role visibility and future RLS/Auth preparation.' },
  { id: 'email', label: 'Email Role Login', group: 'Admin', icon: '✉️', clickText: ['email role login', 'email login'], hash: '#/sup/miami/email-login', description: 'Admin/supervisor/viewer email login preparation.' },
  { id: 'weather', label: 'Weather Alert Control', group: 'Admin', icon: '⛈️', clickText: ['weather alert control', 'weather'], hash: '#/sup/miami/weather-control', description: 'Stop false severe alerts and control official weather notices.' },
  { id: 'charlie', label: 'Charlie AI', group: 'AI', icon: '🤖', clickText: ['charlie ai', 'charlie'], hash: '#charlie', description: 'Interactive assistant for problem-job strategy.' }
];

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

function getGroups(): string[] {
  const groups: string[] = [];
  for (let index = 0; index < SMART_MODULES.length; index += 1) {
    const group = SMART_MODULES[index].group;
    if (groups.indexOf(group) < 0) groups.push(group);
  }
  return groups;
}

function clickByText(options: string[]): boolean {
  const selectors = 'button,a,[role="tab"],[role="button"],nav *';
  const elements = document.querySelectorAll(selectors);
  for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
    const option = options[optionIndex].toLowerCase();
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index] as HTMLElement;
      const text = (element.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (text.indexOf(option) >= 0 && typeof element.click === 'function' && element.id !== 'gfs-smart-ui-button') {
        element.click();
        return true;
      }
    }
  }
  return false;
}

function showSmartToast(message: string): void {
  let toast = document.getElementById('gfs-smart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'gfs-smart-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'show';
  window.setTimeout(() => {
    if (toast) toast.className = '';
  }, 2600);
}

function openSmartModule(module: SmartModule): void {
  if (module.id === 'charlie') {
    const charlieButton = document.getElementById('gfs-charlie-ai-button') as HTMLButtonElement | null;
    if (charlieButton) charlieButton.click();
    showSmartToast('Charlie AI opened.');
    return;
  }

  const clicked = clickByText(module.clickText);
  if (!clicked && module.hash) {
    window.location.hash = module.hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  try {
    window.localStorage.setItem('gfs_smart_last_module', module.id);
  } catch {
    // ignored
  }
  showSmartToast(module.label + ' selected.');
}

function renderModuleButton(module: SmartModule): string {
  return `
    <button class="gfs-smart-module" data-smart-module="${escapeHtml(module.id)}" type="button">
      <span class="gfs-smart-module-icon">${escapeHtml(module.icon)}</span>
      <span><strong>${escapeHtml(module.label)}</strong><small>${escapeHtml(module.description)}</small></span>
    </button>
  `;
}

function renderGroups(): string {
  const groups = getGroups();
  return groups.map((group) => {
    const modules = SMART_MODULES.filter((item) => item.group === group);
    return `
      <section class="gfs-smart-group">
        <h3>${escapeHtml(group)}</h3>
        <div>${modules.map(renderModuleButton).join('')}</div>
      </section>
    `;
  }).join('');
}

function applyUiCleanupClass(): void {
  if (document.body.className.indexOf('gfs-v23-ui-organized') < 0) {
    document.body.className += ' gfs-v23-ui-organized';
  }
}

function ensureSmartUiMounted(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gfs-smart-ui-root')) return;
  applyUiCleanupClass();

  const style = document.createElement('style');
  style.textContent = `
    .gfs-v23-ui-organized{scroll-behavior:smooth}.gfs-v23-ui-organized nav,.gfs-v23-ui-organized [role="tablist"]{max-width:100%;overflow-x:auto;scrollbar-width:thin}.gfs-v23-ui-organized button{touch-action:manipulation}.gfs-v23-ui-organized main,.gfs-v23-ui-organized section{box-sizing:border-box}.gfs-v23-ui-organized table{max-width:100%}
    #gfs-smart-ui-root{position:fixed;left:16px;bottom:18px;z-index:2147482500;font-family:Inter,Arial,sans-serif;color:#0f172a}
    #gfs-smart-ui-button{border:1px solid rgba(255,255,255,.25);border-radius:999px;background:linear-gradient(135deg,#064e3b,#0f766e);color:#fff;padding:12px 16px;font-weight:900;box-shadow:0 14px 38px rgba(15,23,42,.30);cursor:pointer;font-size:14px}
    #gfs-smart-ui-panel{display:none;position:absolute;left:0;bottom:58px;width:min(520px,calc(100vw - 24px));max-height:min(760px,calc(100vh - 105px));overflow:auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:20px;box-shadow:0 24px 70px rgba(15,23,42,.30)}
    #gfs-smart-ui-panel.open{display:block}.gfs-smart-header{position:sticky;top:0;background:linear-gradient(135deg,#ecfeff,#f8fafc);border-bottom:1px solid #e2e8f0;padding:14px 16px;border-radius:20px 20px 0 0;z-index:1}.gfs-smart-header-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.gfs-smart-header h2{font-size:19px;margin:0;color:#0f172a}.gfs-smart-header p{font-size:13px;color:#475569;margin:5px 0 0;line-height:1.35}.gfs-smart-close{border:0;background:#e2e8f0;border-radius:999px;width:30px;height:30px;cursor:pointer;font-weight:900;color:#0f172a}
    .gfs-smart-body{padding:14px}.gfs-smart-group{margin:0 0 14px}.gfs-smart-group h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:0 0 8px}.gfs-smart-group>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gfs-smart-module{display:flex;align-items:flex-start;gap:10px;text-align:left;border:1px solid #e2e8f0;background:#f8fafc;border-radius:14px;padding:11px;cursor:pointer;color:#0f172a;min-height:76px}.gfs-smart-module:hover{background:#eff6ff;border-color:#93c5fd}.gfs-smart-module-icon{font-size:19px;line-height:1.1}.gfs-smart-module strong{display:block;font-size:13px;color:#0f172a}.gfs-smart-module small{display:block;font-size:11px;line-height:1.25;color:#64748b;margin-top:3px}
    #gfs-smart-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);opacity:0;background:#0f172a;color:#fff;border-radius:999px;padding:10px 14px;font-family:Inter,Arial,sans-serif;font-size:13px;font-weight:800;z-index:2147483100;transition:all .18s ease;box-shadow:0 12px 34px rgba(15,23,42,.34)}#gfs-smart-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    @media(max-width:760px){#gfs-smart-ui-root{left:10px;bottom:10px}#gfs-smart-ui-button{padding:11px 13px}#gfs-smart-ui-panel{left:-2px;bottom:54px}.gfs-smart-group>div{grid-template-columns:1fr}}
  `;

  const root = document.createElement('div');
  root.id = 'gfs-smart-ui-root';
  root.innerHTML = `
    <div id="gfs-smart-ui-panel">
      <div class="gfs-smart-header">
        <div class="gfs-smart-header-row">
          <h2>🧭 Guajiro Smart Menu</h2>
          <button class="gfs-smart-close" type="button" aria-label="Close smart menu">×</button>
        </div>
        <p>Organized V23 navigation. Use this instead of hunting through scattered buttons.</p>
      </div>
      <div class="gfs-smart-body">${renderGroups()}</div>
    </div>
    <button id="gfs-smart-ui-button" type="button">🧭 Smart Menu</button>
  `;

  document.head.appendChild(style);
  document.body.appendChild(root);

  const openButton = document.getElementById('gfs-smart-ui-button');
  const panel = document.getElementById('gfs-smart-ui-panel');
  const closeButton = root.querySelector('.gfs-smart-close') as HTMLButtonElement | null;
  openButton?.addEventListener('click', () => panel?.classList.toggle('open'));
  closeButton?.addEventListener('click', () => panel?.classList.remove('open'));

  const moduleButtons = root.querySelectorAll('[data-smart-module]');
  for (let index = 0; index < moduleButtons.length; index += 1) {
    moduleButtons[index].addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLElement;
      const id = target.getAttribute('data-smart-module') || '';
      const found = SMART_MODULES.filter((item) => item.id === id)[0];
      if (found) openSmartModule(found);
    });
  }
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSmartUiMounted, { once: true });
  } else {
    ensureSmartUiMounted();
  }
}

export { ensureSmartUiMounted };
