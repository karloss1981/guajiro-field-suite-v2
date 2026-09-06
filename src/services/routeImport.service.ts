import * as XLSX from 'xlsx';

export type RouteImportJob = {
  date: string;
  tech_id: string;
  job_id: string;
  address: string;
  city: string;
  zip: string;
  type: string;
  phone: string;
  status: 'pending';
  order_num: number;
  region: string;
};

export type RouteImportPreview = {
  filename: string;
  sheetName: string;
  region: string;
  routeDate: string;
  jobs: RouteImportJob[];
  headers: string[];
  invalidPhoneCount: number;
  duplicateJobCount: number;
  technicianCount: number;
  sourceRowCount: number;
  warnings: string[];
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readColumn(row: Record<string, unknown>, ...keys: string[]) {
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    const exact = rowKeys.find((candidate) => normalizeHeader(candidate) === normalized);
    if (exact !== undefined && String(row[exact] ?? '').trim()) return String(row[exact]).trim();
  }
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    const partial = rowKeys.find((candidate) => {
      const candidateNormalized = normalizeHeader(candidate);
      return candidateNormalized.includes(normalized) || normalized.includes(candidateNormalized);
    });
    if (partial !== undefined && String(row[partial] ?? '').trim()) return String(row[partial]).trim();
  }
  return '';
}


function cleanNumberLike(value: string) {
  return String(value || '').trim().replace(/\.0$/, '').replace(/\s+/g, ' ');
}

function normalizeAddressPiece(value: string) {
  return cleanNumberLike(value)
    .replace(/^\s*,+|,+\s*$/g, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readColumnStrict(row: Record<string, unknown>, keys: string[], options: { exclude?: RegExp[] } = {}) {
  const rowKeys = Object.keys(row);
  const exclude = options.exclude || [];
  const allowed = (candidate: string) => !exclude.some((pattern) => pattern.test(normalizeHeader(candidate)));
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    const exact = rowKeys.find((candidate) => allowed(candidate) && normalizeHeader(candidate) === normalized);
    if (exact !== undefined && String(row[exact] ?? '').trim()) return String(row[exact]).trim();
  }
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (normalized.length < 3) continue;
    const partial = rowKeys.find((candidate) => {
      if (!allowed(candidate)) return false;
      const candidateNormalized = normalizeHeader(candidate);
      return candidateNormalized.includes(normalized) || normalized.includes(candidateNormalized);
    });
    if (partial !== undefined && String(row[partial] ?? '').trim()) return String(row[partial]).trim();
  }
  return '';
}

const HOUSE_NUMBER_ALIASES = [
  'House #', 'House#', 'HOUSE #', 'House Number', 'House No', 'House No.', 'Hse #', 'Hse#',
  'Hse Num', 'HSE NUM', 'Hse Number', 'Home #', 'Home Number', 'Street #', 'Street Number',
  'Street No', 'Street No.', 'Civic #', 'Civic Number', 'Address #', 'Address Number', 'Addr #',
  'Svc #', 'Svc Number', 'Service #', 'Service Number', 'Premise #', 'Premise Number', 'Premise No',
  'Loc #', 'Location #', 'Location Number', 'Bldg #', 'Building #', 'Num', 'Nro', 'No', 'Nº'
];

const STREET_ALIASES = [
  'Street Name', 'STREET NAME', 'Street', 'StreetName', 'St Name', 'STREET', 'Road', 'Road Name',
  'Avenue', 'Ave', 'Address Street', 'Service Street', 'Svc Street', 'Location Street', 'Calle', 'Via',
  'Thoroughfare', 'Street Address Line', 'Address Line 1', 'Addr Line 1'
];

const ADDRESS_ALIASES = [
  'Address', 'ADDRESS', 'Full Address', 'Service Address', 'Svc Address', 'Street Address', 'Location',
  'Dirección', 'Dir', 'Domicilio', 'Address 1', 'Address Line 1', 'Service Location', 'Premise Address',
  'Customer Address', 'Work Location', 'Job Address'
];

const ADDRESS_EXCLUDES = [/job/, /work order/, /^wo\b/, /ticket/, /order/, /tech/, /employee/, /phone/, /home/, /business/, /zip/, /postal/, /city/, /state/, /type/, /pay/];
const HOUSE_EXCLUDES = [/job/, /work order/, /^wo\b/, /ticket/, /order/, /tech/, /employee/, /phone/, /home/, /business/, /zip/, /postal/, /city/, /state/, /type/, /pay/];
const STREET_EXCLUDES = [/job/, /work order/, /^wo\b/, /ticket/, /order/, /tech/, /employee/, /phone/, /home/, /business/, /zip/, /postal/, /city/, /state/, /type/, /pay/];

function looksLikeHouseNumber(value: string) {
  const cleaned = normalizeAddressPiece(value).replace(/^#/, '');
  if (!cleaned) return '';
  // Reject phones, job IDs, ZIPs and long account/order values. Allow 123, 123A, 123-1/2, 12B.
  if (/\d{7,}/.test(cleaned.replace(/\D/g, ''))) return '';
  if (!/^\d{1,6}[a-zA-Z]?(?:[-\s]?(?:1\/2|[a-zA-Z]))?$/.test(cleaned)) return '';
  return cleaned;
}

function hasLeadingHouseNumber(address: string) {
  return /^\s*\d{1,6}[a-zA-Z]?(?:[-\s]?(?:1\/2|[a-zA-Z]))?\b/.test(address);
}

export function buildFullAddress(row: Record<string, unknown>, currentAddress = '') {
  const house = looksLikeHouseNumber(readColumnStrict(row, HOUSE_NUMBER_ALIASES, { exclude: HOUSE_EXCLUDES }));
  const street = normalizeAddressPiece(readColumnStrict(row, STREET_ALIASES, { exclude: STREET_EXCLUDES }));
  const address = normalizeAddressPiece(currentAddress) || normalizeAddressPiece(readColumnStrict(row, ADDRESS_ALIASES, { exclude: ADDRESS_EXCLUDES }));

  // If the address column is only the street name and the file has a separate house column,
  // force the final address to keep both in the same column used by the app/database.
  if (house && street) return `${house} ${street}`.trim();
  if (house && address && !hasLeadingHouseNumber(address)) return `${house} ${address}`.trim();
  if (!address && (house || street)) return `${house} ${street}`.trim();
  return address;
}

export function normalizeRouteAddressFromRow(row: Record<string, unknown>, currentAddress = '') {
  return buildFullAddress(row, currentAddress);
}

function detectColumn(headers: string[], rows: any[], names: string[], mode: 'tech' | 'job' | 'address') {
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (names.some((name) => normalized === name || normalized.startsWith(name) || normalized.includes(name))) return header;
  }
  for (const header of headers) {
    const values = rows.slice(0, 15).map((row) => String(row[header] ?? '').trim()).filter(Boolean);
    if (!values.length) continue;
    if (mode === 'tech') {
      const numeric = values.filter((value) => /^\d{2,7}(\.0)?$/.test(value)).length;
      if (numeric >= Math.min(3, Math.ceil(values.length * 0.5))) return header;
    }
    if (mode === 'job') {
      if (new Set(values).size >= Math.min(5, values.length) && values.some((value) => /\d{5,}/.test(value))) return header;
    }
    if (mode === 'address') {
      const addressLike = values.filter((value) => /^\d+\s+\w/.test(value) || /\b(st|ave|blvd|dr|rd|ln|ct|way|pl|terr|ter|cir)\b/i.test(value)).length;
      if (addressLike >= Math.min(2, values.length)) return header;
    }
  }
  return null;
}

export async function parseRouteImport(file: File, region: string, routeDate = new Date().toLocaleDateString('en-CA')): Promise<RouteImportPreview> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  let rows: any[] = [];
  let sheetName = '';

  for (const candidate of workbook.SheetNames) {
    const worksheet = workbook.Sheets[candidate];
    const directRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
    if (directRows.length) {
      rows = directRows;
      sheetName = candidate;
      break;
    }
    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false, header: 1 });
    for (let skip = 1; skip <= 5; skip += 1) {
      if (rawRows.length <= skip) continue;
      const headers = rawRows[skip] || [];
      const parsed = rawRows
        .slice(skip + 1)
        .map((row) => {
          const item: Record<string, unknown> = {};
          headers.forEach((header, index) => {
            item[String(header || `col_${index}`).trim()] = String(row?.[index] ?? '').trim();
          });
          return item;
        })
        .filter((row) => Object.values(row).some((value) => String(value).trim()));
      if (parsed.length) {
        rows = parsed;
        sheetName = candidate;
        break;
      }
    }
    if (rows.length) break;
  }

  if (!rows.length) throw new Error('The Excel file is empty or has no readable data.');

  const headers = Object.keys(rows[0] || {});
  const techColumn = detectColumn(headers, rows, ['tech', 'technician', 'tech id', 'techid', 'emp', 'employee', 'tec', 'técnico', 'worker', 'operario', 'op #', 'op#'], 'tech');
  const jobColumn = detectColumn(headers, rows, ['job id', 'job#', 'job #', 'jobid', 'work order', 'order', 'wo #', 'wo#', 'ticket', 'job number', 'service order', 'order #', 'orden', 'folio'], 'job');
  const addressColumn = detectColumn(headers, rows, ['address', 'full address', 'service address', 'svc address', 'street address', 'location', 'dirección', 'dir', 'domicilio'], 'address');

  const jobs: RouteImportJob[] = [];
  const seen = new Set<string>();
  let duplicateJobCount = 0;
  let invalidPhoneCount = 0;
  let invalidTechCount = 0;
  // V25.2 hard rule: a technician id is EXACTLY 4 digits (roster shape).
  // Anything else (notes, addresses, free text leaked into the column) must
  // never become a tech group — the job imports as Unassigned + a warning.
  const TECH_ID_SHAPE = /^\d{4}$/;

  rows.forEach((row, index) => {
    let rawTech = techColumn ? String(row[techColumn] ?? '').trim() : '';
    if (!rawTech) rawTech = readColumn(row, 'Tech', 'Technician', 'Tech ID', 'TechID', 'Emp #', 'EMP', 'Employee', 'Tech #', 'Tec', 'Técnico', 'Op #', 'Operario');
    const techIdRaw = rawTech.replace(/\.0$/, '').replace(/\s+/g, '').toUpperCase();
    const techId = TECH_ID_SHAPE.test(techIdRaw) ? techIdRaw : '';
    if (techIdRaw && !techId) invalidTechCount += 1;

    let rawJob = jobColumn ? String(row[jobColumn] ?? '').trim() : '';
    if (!rawJob) rawJob = readColumn(row, 'Job Id', 'Job ID', 'Job #', 'Work Order', 'WO #', 'WO', 'JobId', 'Ticket', 'Service Order', 'Order #', 'Orden', 'Folio');
    const jobId = rawJob.replace(/\.0$/, '').replace(/\s+/g, '');

    if (!jobId) return;
    if (seen.has(jobId)) {
      duplicateJobCount += 1;
      return;
    }
    seen.add(jobId);

    let address = addressColumn ? String(row[addressColumn] ?? '').trim() : '';
    if (!address) address = readColumn(row, 'Address', 'Full Address', 'Service Address', 'Svc Address', 'Location', 'Street Address', 'Dirección', 'Dir', 'Domicilio');
    address = buildFullAddress(row, address);
    if (!address) return;

    const city = readColumn(row, 'City', 'CITY', 'Municipality', 'Ciudad', 'Town', 'Municipio', 'Localidad');
    const zip = readColumn(row, 'Zip Code', 'ZIP CODE', 'Zip', 'ZIP', 'Postal', 'Zip/Postal', 'Zipcode', 'CP', 'Código Postal');
    const type = readColumn(row, 'Type', 'TYPE', 'Job Type', 'JobType', 'Work Type', 'Appt Type', 'Appointment Type', 'Tipo', 'Tipo de Trabajo') || 'JS:BURY COAX';
    const rawPhone = readColumn(row, 'Home', 'HOME', 'Phone', 'Tel', 'Phone Number', 'Cell', 'Mobile', 'Contact Phone', 'Customer Phone', 'Business', 'Alt Phone', 'Teléfono', 'Telefono');
    const phone = rawPhone.replace(/\D/g, '').slice(-10);
    if (rawPhone && phone.length !== 10) invalidPhoneCount += 1;

    jobs.push({
      date: routeDate,
      tech_id: techId,
      job_id: jobId,
      address,
      city,
      zip,
      type,
      phone,
      status: 'pending',
      order_num: index,
      region,
    });
  });

  if (!jobs.length) {
    throw new Error(`No valid jobs were detected. Columns found: ${headers.join(', ')}`);
  }

  const warnings: string[] = [];
  if (duplicateJobCount) warnings.push(`${duplicateJobCount} duplicate job IDs were skipped.`);
  if (invalidPhoneCount) warnings.push(`${invalidPhoneCount} phone numbers need review.`);
  if (invalidTechCount) warnings.push(`${invalidTechCount} rows had text instead of a 4-digit tech # — imported as Unassigned.`);
  if (!techColumn) warnings.push('Technician column was inferred from values.');
  if (!jobColumn) warnings.push('Job ID column was inferred from values.');
  if (!addressColumn) warnings.push('Address column was inferred from values.');

  return {
    filename: file.name,
    sheetName,
    region,
    routeDate,
    jobs,
    headers,
    invalidPhoneCount,
    duplicateJobCount,
    technicianCount: new Set(jobs.map((job) => job.tech_id).filter(Boolean)).size,
    sourceRowCount: rows.length,
    warnings,
  };
}
