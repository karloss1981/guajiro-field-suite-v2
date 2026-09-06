import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '';
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = [];
const warn = [];
const pass = [];

function mustExist(file, label = file) {
  if (exists(file)) pass.push(`OK: ${label}`);
  else fail.push(`MISSING: ${label}`);
}

function mustInclude(file, needle, label) {
  const text = read(file);
  if (text.includes(needle)) pass.push(`OK: ${label}`);
  else fail.push(`MISSING TEXT: ${label} in ${file}`);
}

function mustNotInclude(file, needle, label) {
  const text = read(file);
  if (!text.includes(needle)) pass.push(`OK: ${label}`);
  else fail.push(`FORBIDDEN TEXT: ${label} in ${file}`);
}

function softInclude(file, needle, label) {
  const text = read(file);
  if (text.includes(needle)) pass.push(`OK: ${label}`);
  else warn.push(`CHECK: ${label} not found in ${file}`);
}

mustExist('package.json', 'package.json');
mustExist('src/config/supabase.ts', 'Supabase config');
mustExist('src/features/technician/pages/TechPortal.tsx', 'Technician portal');
mustExist('src/features/dispatch/pages/DispatchPage.tsx', 'Dispatch page');
mustExist('src/features/dispatch/components/DispatchIncidentsCenter.tsx', 'Incidents center');
mustExist('src/features/dispatch/components/DispatchReworkQA.tsx', 'QA/Rework center');
mustExist('src/features/dispatch/components/DispatchCloseoutQA.tsx', 'Billing QA center');
mustExist('src/offline/photoUploadQueue.ts', 'Offline photo queue');
mustExist('src/offline/pendingCloseQueue.ts', 'Pending close queue');
mustExist('src/services/routeImport.service.ts', 'Route import parser');
mustExist('src/services/routeDate.service.ts', 'Route date resolver');
mustExist('src/services/superAdminAuth.service.ts', 'Super Admin auth service');
mustExist('src/services/roleEmailAuth.service.ts', 'Role email login service');
mustExist('src/services/roleAccess.service.ts', 'Role access/capability service');
mustExist('src/services/actionGuard.service.ts', 'Destructive action guard service');
mustExist('src/components/SuperAdminDeleteGate.tsx', 'Super Admin delete gate component');
mustExist('src/services/routeDelete.service.ts', 'V25.1 route delete RPC service');
mustExist('supabase/migrations/202607010001_v25_1_super_admin_route_delete_rpc.sql', 'V25.1 super_admin_delete_route migration');
mustExist('README_V25_1_DB_DELETE_FIX.md', 'V25.1 README');
mustExist('FINAL_TEST_RC_CHECKLIST.md', 'V25 Final Test RC manual checklist');
mustExist('00_DOBLE_CLICK_AQUI_ABRIR_APP.bat', 'one-click BAT');

mustInclude('src/services/routeImport.service.ts', 'buildFullAddress', 'house number + address merge');
mustInclude('src/services/routeDate.service.ts', '19', '7 PM / next-day route logic');
mustInclude('src/features/technician/pages/TechPortal.tsx', 'pendingClose', 'Pending Close integration');
mustInclude('src/features/technician/pages/TechPortal.tsx', 'queued_close', 'queued close audit marker');
mustInclude('src/offline/photoUploadQueue.ts', 'putOffline', 'local photo queue storage');
mustInclude('src/offline/pendingCloseQueue.ts', 'markPendingCloseFailed', 'failed pending close retention');
mustInclude('src/features/dispatch/components/DispatchTechnicianStats.tsx', 'customer absent', 'dispatch phrase search');
mustInclude('src/features/dispatch/components/DispatchIncidentsCenter.tsx', 'misil', 'incident category search');
mustInclude('src/features/dispatch/components/DispatchReworkQA.tsx', 'createRework', 'rework creation workflow');
mustInclude('src/features/auth/pages/SecurityAdminPage.tsx', 'runtimeStatus', 'security admin runtime status');
mustInclude('src/features/supervisor/pages/SupervisorPortal.tsx', 'SuperAdminDeleteGate', 'route delete wired to Super Admin gate');
mustInclude('src/features/supervisor/pages/SupervisorPortal.tsx', 'deleteRouteAsSuperAdmin', 'route delete uses V25.1 RPC service');
mustInclude('src/features/supervisor/components/RouteArchive.tsx', 'checkDestructiveAction', 'route restore gated by Super Admin check');
mustInclude('supabase/migrations/202607010001_v25_1_super_admin_route_delete_rpc.sql', 'security definer', 'RPC uses SECURITY DEFINER');
mustInclude('src/services/superAdminAuth.service.ts', 'karloss1981@gmail.com', 'official Super Admin email configured');
mustInclude('src/services/superAdminAuth.service.ts', "authMode !== 'supabase'", 'PIN/legacy sessions excluded from Super Admin check');

mustNotInclude('src/pwa/registerPWA.ts', 'self.skipWaiting()', 'no automatic service-worker skipWaiting');
mustNotInclude('src/config/access.ts', 'VITE_ADMIN_PIN', 'admin PIN not exposed in frontend config');
mustNotInclude('src/services/auth.service.ts', '.select(\'pin\')', 'secure technician login does not select plaintext pin');

softInclude('SUPABASE_V23_5_SECURITY_AUTH_RLS.sql', 'verify_technician_pin', 'secure technician PIN RPC SQL');
softInclude('SUPABASE_V23_4_INCIDENTS_CENTER.sql', 'incident_reports', 'incidents SQL');
softInclude('SUPABASE_V23_3_QA_REWORK_UPGRADES.sql', 'reworks', 'QA/rework SQL');

console.log('\nGUAJIRO SMOKE CHECK');
console.log('===================');
pass.forEach((line) => console.log(`PASS  ${line}`));
warn.forEach((line) => console.log(`WARN  ${line}`));
fail.forEach((line) => console.error(`FAIL  ${line}`));
console.log(`\nResult: ${pass.length} pass, ${warn.length} warn, ${fail.length} fail`);

if (fail.length) process.exit(1);
