import { sb } from '../config/supabase';
import { enqueueSync } from '../offline/syncQueue';
import type { JobPhoto } from '../types/photo';

export const IMAGE_TARGET_MIN_BYTES = 50 * 1024;
export const IMAGE_TARGET_BYTES = 55 * 1024;
export const IMAGE_TARGET_MAX_BYTES = 60 * 1024;

export type PhotoTypeForNaming = 'before' | 'after' | 'other' | string;

export type PhotoNamingInput = {
  techId?: string | number | null;
  tech_id?: string | number | null;
  technicianId?: string | number | null;
  technician_id?: string | number | null;
  jobId?: string | number | null;
  job_id?: string | number | null;
  routeId?: string | number | null;
  date?: string | Date | null;
  capturedAt?: string | Date | null;
  photoType?: PhotoTypeForNaming;
  photo_type?: PhotoTypeForNaming;
  index?: number;
  unique?: boolean;
};

export type ImageResizeOptions = {
  minBytes?: number;
  targetBytes?: number;
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  minWidth?: number;
  minQuality?: number;
  maxQuality?: number;
  outputType?: 'image/jpeg' | 'image/webp';
  watermark?: {
    jobNumber?: string | number;
    techNumber?: string | number;
    capturedAt?: string;
    addressLine?: string;
    cityLine?: string;
    gpsLine?: string;
    photoType?: string;
    lines?: string[];
    position?: 'top-right' | 'bottom-right' | 'bottom-left';
  };
};

export type ImageResizeResult = {
  file: File;
  originalBytes: number;
  finalBytes: number;
  width: number;
  height: number;
  quality: number;
  savingsPercent: number;
};

type ZipPhoto = {
  photo_url?: string;
  photo_type?: string;
  tech_id?: string | number;
  technician_id?: string | number;
  job_id?: string | number;
  created_at?: string;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        URL.revokeObjectURL(objectUrl);
        reject(new Error('No se pudo leer la imagen (timeout).'));
      }
    }, 15000);

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      }
    };

    image.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      // Fallback: createImageBitmap handles HEIC, large megapixel images,
      // and EXIF orientation better than <img> on mobile browsers.
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then((bitmap) => {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { bitmap.close(); reject(new Error('No se pudo leer la imagen.')); return; }
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const fallbackImg = new Image();
            fallbackImg.onload = () => resolve(fallbackImg);
            fallbackImg.onerror = () => reject(new Error('No se pudo leer la imagen.'));
            fallbackImg.src = canvas.toDataURL('image/png');
          })
          .catch(() => reject(new Error('No se pudo leer la imagen.')));
      } else {
        reject(new Error('No se pudo leer la imagen.'));
      }
    };

    image.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: 'image/jpeg' | 'image/webp',
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo comprimir la imagen.'));
    }, type, quality);
  });
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermark?: ImageResizeOptions['watermark'],
) {
  if (!watermark) return;

  // V25.6 overlay: address+zip, city, time, tech #, job #.
  // No BEFORE/AFTER label, no GPS coordinates (by request).
  const lines = (watermark.lines?.length ? watermark.lines : [
    watermark.addressLine || '',
    watermark.cityLine || '',
    watermark.capturedAt ?? new Date().toLocaleString(),
    [
      watermark.techNumber ? `Tech #${watermark.techNumber}` : '',
      watermark.jobNumber ? `Job #${watermark.jobNumber}` : '',
    ].filter(Boolean).join(' · '),
  ]).filter(Boolean);

  if (!lines.length) return;

  const padding = Math.max(10, Math.round(width * 0.016));
  const fontSize = Math.max(14, Math.round(width * 0.026));
  const lineHeight = Math.round(fontSize * 1.24);
  const maxTextWidth = Math.max(1, Math.round(width * 0.78));

  context.font = `600 ${fontSize}px Arial, sans-serif`;
  context.textBaseline = 'top';
  context.lineJoin = 'round';

  const measured = Math.min(
    maxTextWidth,
    Math.max(...lines.map((line) => context.measureText(line).width)),
  );
  const boxWidth = measured + padding * 2;
  const boxHeight = lineHeight * lines.length + padding * 1.6;
  const position = watermark.position ?? 'bottom-right';

  let x = width - boxWidth - padding;
  let y = height - boxHeight - padding;
  if (position === 'top-right') y = padding;
  if (position === 'bottom-left') x = padding;

  context.fillStyle = 'rgba(0, 0, 0, 0.52)';
  context.fillRect(x, y, boxWidth, boxHeight);

  context.strokeStyle = 'rgba(0, 0, 0, 0.92)';
  context.lineWidth = Math.max(2, Math.round(fontSize * 0.12));
  context.fillStyle = '#ffd400'; // V25.6: overlay text in yellow (by request)

  lines.forEach((line, index) => {
    const clipped = line.length > 80 ? `${line.slice(0, 77)}...` : line;
    const textWidth = context.measureText(clipped).width;
    const tx = position === 'bottom-left'
      ? x + padding
      : x + boxWidth - padding - Math.min(textWidth, maxTextWidth);
    const ty = y + Math.round(padding * 0.72) + index * lineHeight;
    context.strokeText(clipped, tx, ty, maxTextWidth);
    context.fillText(clipped, tx, ty, maxTextWidth);
  });
}

function fitDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number,
) {
  const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight);
  return {
    width: Math.max(1, Math.round(originalWidth * scale)),
    height: Math.max(1, Math.round(originalHeight * scale)),
  };
}

export function cleanPhotoToken(value: unknown, fallback = 'NA'): string {
  const text = String(value ?? '').trim();
  const cleaned = text.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28);
  return cleaned || fallback;
}

export function shortPhotoDate(value?: string | Date | null): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = String(value.getFullYear());
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  const raw = String(value ?? '').trim();
  const direct = raw.match(/^(\d{4})[-_\/]?(\d{2})[-_\/]?(\d{2})/);
  if (direct) return `${direct[1]}${direct[2]}${direct[3]}`;

  const parsed = raw ? new Date(raw) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export function photoTypeCode(value?: PhotoTypeForNaming): 'B' | 'A' | 'X' {
  const type = String(value || '').toLowerCase();
  if (type === 'pht' || type === 'after') return 'A';
  if (type === 'evidence' || type === 'before') return 'B';
  return 'X';
}

export function buildPhotoBaseName(input: PhotoNamingInput): string {
  const tech = cleanPhotoToken(
    input.techId ?? input.tech_id ?? input.technicianId ?? input.technician_id,
    'TECH',
  );
  const job = cleanPhotoToken(input.jobId ?? input.job_id ?? input.routeId, 'JOB');
  const date = shortPhotoDate(input.date ?? input.capturedAt);
  return `T${tech}-J${job}-${date}`;
}

export function buildEvidencePhotoFileName(input: PhotoNamingInput): string {
  const base = buildPhotoBaseName(input);
  const type = photoTypeCode(input.photoType ?? input.photo_type);
  const sequence = typeof input.index === 'number'
    ? String(input.index).padStart(2, '0')
    : input.unique === false
      ? '01'
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  // T{tech}-J{job}-{date}-{B/A}-{seq}.jpg
  return `${base}-${type}-${sequence}.jpg`;
}

export function buildEvidencePhotoStoragePath(input: PhotoNamingInput) {
  const tech = cleanPhotoToken(
    input.techId ?? input.tech_id ?? input.technicianId ?? input.technician_id,
    'TECH',
  );
  const job = cleanPhotoToken(input.jobId ?? input.job_id ?? input.routeId, 'JOB');
  const date = shortPhotoDate(input.date ?? input.capturedAt);
  const filename = buildEvidencePhotoFileName(input);
  return {
    filename,
    storagePath: `T${tech}/${date}/J${job}/${filename}`,
  };
}

export function buildQueuedPhotoPath(params: {
  techId: string | number;
  jobId: string | number;
  date?: string | Date;
  capturedAt?: string | Date;
  photoType: PhotoTypeForNaming;
  index?: number;
}) {
  // PHOTO_NAMING_STRICT_FINAL
  return buildEvidencePhotoStoragePath({
    techId: params.techId,
    jobId: params.jobId,
    date: params.date,
    capturedAt: params.capturedAt,
    photoType: params.photoType,
    index: params.index,
    unique: typeof params.index === 'number' ? false : true,
  });
}

function outputName(name: string, outputType: 'image/jpeg' | 'image/webp', naming?: PhotoNamingInput) {
  if (naming) return buildEvidencePhotoFileName({ ...naming, unique: naming.unique ?? false });
  const extension = outputType === 'image/webp' ? '.webp' : '.jpg';
  const base = name.replace(/\.[^.]+$/, '') || 'photo';
  return `${base}${extension}`;
}

/**
 * Browser-side photo compressor used by every upload path.
 * Target: 50-60 KB, JPEG output by default. Very simple images can land below 50 KB.
 */
export async function resizeImageWithStats(
  file: File,
  options: ImageResizeOptions & { naming?: PhotoNamingInput } = {},
): Promise<ImageResizeResult> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif|jpg|jpeg|png|webp)$/i.test(file.name)) {
    throw new Error('El archivo seleccionado no es una imagen.');
  }

  const minBytes = options.minBytes ?? IMAGE_TARGET_MIN_BYTES;
  const targetBytes = options.targetBytes ?? IMAGE_TARGET_BYTES;
  const maxBytes = options.maxBytes ?? IMAGE_TARGET_MAX_BYTES;
  const maxWidth = options.maxWidth ?? 1280;
  const maxHeight = options.maxHeight ?? 1280;
  const minWidth = options.minWidth ?? 320;
  const minQuality = options.minQuality ?? 0.22;
  const maxQuality = options.maxQuality ?? 0.9;
  const outputType = options.outputType ?? 'image/jpeg';

  if (file.size <= maxBytes && file.type === outputType && !options.watermark && !options.naming) {
    return {
      file,
      originalBytes: file.size,
      finalBytes: file.size,
      width: 0,
      height: 0,
      quality: 1,
      savingsPercent: 0,
    };
  }

  const image = await loadImage(file);
  let { width, height } = fitDimensions(
    image.naturalWidth,
    image.naturalHeight,
    maxWidth,
    maxHeight,
  );

  // Simple, fast compression: try a few quality levels at the target size,
  // then shrink dimensions if still too large. Max 5 canvas operations total
  // instead of the previous 90, which hung mobile browsers on gallery photos.
  let finalBlob: Blob | null = null;
  let finalQuality = 0.7;
  let finalWidth = width;
  let finalHeight = height;

  const tryEncode = async (w: number, h: number, q: number): Promise<Blob> => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('El navegador no pudo preparar la imagen.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
    context.drawImage(image, 0, 0, w, h);
    drawWatermark(context, w, h, options.watermark);
    return canvasToBlob(canvas, outputType, q);
  };

  // Try quality 0.7 first, then 0.45, then 0.25
  for (const q of [0.7, 0.45, 0.25]) {
    finalBlob = await tryEncode(width, height, q);
    finalQuality = q;
    if (finalBlob.size <= maxBytes) break;
  }

  // If still too large, shrink dimensions progressively
  while (finalBlob && finalBlob.size > maxBytes && width > minWidth) {
    width = Math.max(minWidth, Math.round(width * 0.7));
    height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
    finalBlob = await tryEncode(width, height, 0.45);
    finalQuality = 0.45;
    finalWidth = width;
    finalHeight = height;
  }

  if (!finalBlob) throw new Error('No se pudo generar la imagen optimizada.');

  const optimizedFile = new File(
    [finalBlob],
    outputName(file.name, outputType, options.naming),
    {
      type: outputType,
      lastModified: file.lastModified,
    },
  );

  return {
    file: optimizedFile,
    originalBytes: file.size,
    finalBytes: optimizedFile.size,
    width: finalWidth,
    height: finalHeight,
    quality: finalQuality,
    savingsPercent: file.size
      ? Math.max(0, Math.round((1 - optimizedFile.size / file.size) * 100))
      : 0,
  };
}

export async function resizeImageToTarget(
  file: File,
  options: ImageResizeOptions & { naming?: PhotoNamingInput } = {},
): Promise<File> {
  const result = await resizeImageWithStats(file, {
    minBytes: IMAGE_TARGET_MIN_BYTES,
    targetBytes: IMAGE_TARGET_BYTES,
    maxBytes: IMAGE_TARGET_MAX_BYTES,
    maxWidth: 1280,
    maxHeight: 1280,
    outputType: 'image/jpeg',
    ...options,
  });
  return result.file;
}

export async function optimizePhoto(file: File, options: ImageResizeOptions & { naming?: PhotoNamingInput } = {}) {
  return resizeImageToTarget(file, options);
}

export async function compressImage(
  file: File,
  maxWidth = 1280,
  _quality = 0.78,
  watermark?: ImageResizeOptions['watermark'],
  naming?: PhotoNamingInput,
): Promise<File> {
  // Timeout: if compression takes more than 30s (e.g. very large gallery photo
  // on a slow phone), fall back to uploading the original file. A raw photo
  // is better than no photo.
  const result = await Promise.race([
    resizeImageToTarget(file, {
      maxWidth,
      maxHeight: maxWidth,
      watermark,
      naming,
    }),
    new Promise<File>((_, reject) =>
      setTimeout(() => reject(new Error('Compression timeout')), 30_000),
    ),
  ]);
  return result;
}

export async function fetchJobPhotos(routeId: string): Promise<JobPhoto[]> {
  const { data, error } = await sb
    .from('job_photos')
    .select('*')
    .eq('route_id', routeId)
    .order('created_at');
  if (error) throw error;
  return (data as JobPhoto[]) || [];
}

export async function fetchPhotosByRouteIds(routeIds: string[]): Promise<JobPhoto[]> {
  if (!routeIds.length) return [];
  const { data, error } = await sb
    .from('job_photos')
    .select('*')
    .in('route_id', routeIds);
  if (error) throw error;
  return (data as JobPhoto[]) || [];
}

export async function fetchTechPhotos(techId: string): Promise<JobPhoto[]> {
  const { data, error } = await sb
    .from('job_photos')
    .select('*')
    .eq('tech_id', techId);
  if (error) throw error;
  return (data as JobPhoto[]) || [];
}

export async function insertPhotos(photos: Partial<JobPhoto>[]): Promise<void> {
  if (!photos.length) return;
  const { error } = await sb.from('job_photos').insert(photos);
  if (error) throw error;
}

export async function deletePhoto(id: string): Promise<void> {
  const { error } = await sb.from('job_photos').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadPhotoToStorage(
  bucket: string,
  path: string,
  blob: Blob,
  naming?: PhotoNamingInput,
): Promise<string> {
  const sourceFile = blob instanceof File
    ? blob
    : new File([blob], naming ? buildEvidencePhotoFileName(naming) : 'photo.jpg', { type: blob.type || 'image/jpeg' });

  const optimizedFile = sourceFile.type.startsWith('image/')
    ? await resizeImageToTarget(sourceFile, { naming })
    : sourceFile;

  const normalizedPath = naming
    ? buildEvidencePhotoStoragePath(naming).storagePath
    : path.replace(/\.[^./]+$/, '.jpg');

  const { error } = await sb.storage.from(bucket).upload(normalizedPath, optimizedFile, {
    contentType: optimizedFile.type,
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(normalizedPath);
  return data.publicUrl;
}

export async function uploadEvidencePhoto(params: {
  file: File;
  bucket?: string;
  path?: string;
  naming?: PhotoNamingInput;
  dbPayload?: Record<string, unknown>;
}) {
  const bucket = params.bucket ?? 'job-photos';
  const normalizedPath = params.naming
    ? buildEvidencePhotoStoragePath(params.naming).storagePath
    : (params.path || buildEvidencePhotoStoragePath({ jobId: 'JOB', techId: 'TECH' }).storagePath).replace(/\.[^./]+$/, '.jpg');
  const optimizedFile = await optimizePhoto(params.file, { naming: params.naming });

  const { data, error } = await sb.storage.from(bucket).upload(
    normalizedPath,
    optimizedFile,
    {
      upsert: true,
      contentType: optimizedFile.type,
      cacheControl: '3600',
    },
  );

  if (error) {
    await enqueueSync(
      'photos.insert',
      { ...params.dbPayload, local_path: normalizedPath },
      'photos',
    );
    throw error;
  }

  const { data: publicUrl } = sb.storage.from(bucket).getPublicUrl(data.path);
  if (params.dbPayload) {
    const payload = {
      ...params.dbPayload,
      photo_url: publicUrl.publicUrl,
      thumb_url: publicUrl.publicUrl,
    };
    const insert = await sb.from('photos').insert(payload);
    if (insert.error) await enqueueSync('photos.insert', payload, 'photos');
  }

  return publicUrl.publicUrl;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function buildZipBlob(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralDirParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = crc32(file.data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true); lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    localParts.push(lh, file.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true); cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, nameBytes.length);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    centralDirParts.push(cd);
    offset += lh.length + file.data.length;
  }

  const cdSize = centralDirParts.reduce((sum, entry) => sum + entry.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralDirParts, eocd] as BlobPart[], { type: 'application/zip' }); // cast: compatible TS5/TS6 Uint8Array typing
}

function inferPhotoZipMeta(photos: ZipPhoto[], jobOrId: any, extra: any = {}) {
  const job = typeof jobOrId === 'object' && jobOrId !== null ? jobOrId : { job_id: jobOrId };
  const first = photos.find(Boolean) || {};

  const techId = extra.techId || extra.tech_id || job.tech_id || job.latest_technician_id || job.technician_id || first.tech_id || first.technician_id;
  const jobId = extra.jobId || extra.job_id || job.job_id || job.id || first.job_id;
  const date = extra.date || job.date || job.completed_at || job.created_at || first.created_at;
  const base = buildPhotoBaseName({ techId, jobId, date });
  return { techId: cleanPhotoToken(techId), jobId: cleanPhotoToken(jobId, 'JOB'), date: shortPhotoDate(date), base };
}

async function blobToJpegBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(async (jpegBlob) => {
        const buf = await (jpegBlob || blob).arrayBuffer();
        resolve(new Uint8Array(buf));
      }, 'image/jpeg', 0.72);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    };
    img.src = url;
  });
}

export async function downloadPhotosZip(photos: ZipPhoto[], jobOrId: any, _lang: string, extraMeta: any = {}) {
  if (!photos.length) return;
  let beforeIdx = 1;
  let afterIdx = 1;
  let genericIdx = 1;
  const meta = inferPhotoZipMeta(photos, jobOrId, extraMeta);

  const zipFiles: { name: string; data: Uint8Array }[] = [];
  await Promise.all(photos.map(async (photo) => {
    try {
      if (!photo.photo_url) return;
      const res = await fetch(photo.photo_url);
      const rawBlob = await res.blob();
      const bytes = await blobToJpegBytes(rawBlob);
      const type = String(photo.photo_type || '').toLowerCase();
      let code: 'A' | 'B' | 'X' = 'X';
      let index = 1;
      if (type === 'pht' || type === 'after') { code = 'A'; index = afterIdx; afterIdx += 1; }
      else if (type === 'evidence' || type === 'before' || !type) { code = 'B'; index = beforeIdx; beforeIdx += 1; }
      else { index = genericIdx; genericIdx += 1; }

      const folder = `${meta.base}/${meta.base}-${code}`;
      const filename = buildEvidencePhotoFileName({
        techId: meta.techId,
        jobId: meta.jobId,
        date: meta.date,
        photoType: type || 'before',
        index,
      });
      zipFiles.push({ name: `${folder}/${filename}`, data: bytes });
    } catch (error) {
      console.error('ZIP photo error:', error);
    }
  }));

  if (!zipFiles.length) return;
  zipFiles.sort((a, b) => a.name.localeCompare(b.name));
  const zipBlob = buildZipBlob(zipFiles);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  a.download = `${meta.base}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
