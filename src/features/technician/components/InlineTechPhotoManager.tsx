// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { sb } from '../../../config/supabase';
import { buildQueuedPhotoPath } from '../../../services/photos.service';
import { Lightbox } from './Lightbox';
import { createAuditLog } from '../../../services/audit.service';
import { buildPhotoTimestampLocation, formatPhotoTimestampDate } from '../../../services/photoTimestamp.service';

const BUCKET = 'job-photos';

function InlineTechPhotoManager({ job, techId, t, lang }) {
  const es = lang === 'es';
  const [photos, setPhotos] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [activeType, setActiveType] = useState('evidence');
  const [deleting, setDeleting] = useState(null);
  const fileRefBefore = useRef(null);
  const fileRefAfter = useRef(null);
  const cameraRefBefore = useRef(null);
  const cameraRefAfter = useRef(null);
  const [webcamType, setWebcamType] = useState(null);
  const [webcamError, setWebcamError] = useState('');
  const videoRef = useRef(null);
  const webcamStreamRef = useRef(null);

  const loadRemote = useCallback(async () => {
    try {
      const { data } = await sb
        .from('job_photos')
        .select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at')
        .eq('route_id', job.id)
        .order('created_at');
      setPhotos(data || []);
    } catch (error) {
      console.warn('[InlineTechPhotoManager] load remote photos failed:', error);
    }
  }, [job.id]);

  useEffect(() => { loadRemote(); }, [loadRemote]);

  const stopWebcam = useCallback(() => {
    try {
      webcamStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    } catch {}
    webcamStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setWebcamType(null);
  }, []);

  useEffect(() => () => stopWebcam(), [stopWebcam]);

  useEffect(() => {
    if (!webcamType || !videoRef.current || !webcamStreamRef.current) return;
    videoRef.current.srcObject = webcamStreamRef.current;
    videoRef.current.play?.().catch(() => {});
  }, [webcamType]);

  const openCamera = async (photoType, fallbackRef) => {
    try {
      window.sessionStorage.setItem('gfs_pending_camera_photo_type', String(photoType));
    } catch {}
    setActiveType(photoType);
    setWebcamError('');

    const ua = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    if (mobile) {
      fallbackRef.current?.click();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setWebcamError(es ? 'Este navegador no permite cámara directa. Usa Files o prueba Chrome/Edge.' : 'This browser does not allow direct camera. Use Files or try Chrome/Edge.');
      fallbackRef.current?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      webcamStreamRef.current = stream;
      setWebcamType(photoType);
    } catch (error) {
      console.warn('[InlineTechPhotoManager] webcam open failed:', error);
      setWebcamError(es ? 'No se pudo abrir la cámara. Revisa permisos del navegador o usa Files.' : 'Could not open camera. Check browser permissions or use Files.');
      setTimeout(() => fallbackRef.current?.click(), 50);
    }
  };

  const captureWebcamPhoto = async () => {
    const video = videoRef.current;
    const photoType = webcamType || 'evidence';
    if (!video) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      alert(es ? 'No se pudo capturar la foto.' : 'Could not capture photo.');
      return;
    }
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    stopWebcam();
    await handleFiles({ target: { files: [file], value: '' } }, photoType);
  };

  const uploadDirect = async (file: File, storagePath: string, photoType: string, routeId: string) => {
    const { data: uploadData, error: uploadError } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, file, { cacheControl: '3600', upsert: true, contentType: file.type || 'image/jpeg' });
    if (uploadError) throw uploadError;
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    const { error: insertError } = await sb.from('job_photos').insert({
      route_id: routeId,
      tech_id: String(techId),
      job_id: String(job.job_id || ''),
      photo_url: publicUrl,
      thumb_url: publicUrl,
      note: '',
      photo_type: photoType,
    });
    if (insertError) throw insertError;
    return publicUrl;
  };

  const handleFiles = async (e, photoType) => {
    const allFiles = Array.from(e.target.files || []);
    const files = allFiles.filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|webp)$/i.test(f.name));
    if (!files.length) return;
    if (files.length < allFiles.length) {
      alert(es ? 'Solo se permiten imágenes. Los videos no están permitidos.' : 'Only images are allowed. Videos are not permitted.');
    }

    const total = files.length;
    setUploadProgress({ done: 0, total, type: photoType, phase: 'upload' });

    const stamp = await buildPhotoTimestampLocation(job);

    const before = photos.filter((p) => p.photo_type === 'evidence' || p.photo_type === 'before' || !p.poto_type);
    const after = photos.filter((p) => p.photo_type === 'pht' || p.photo_type === 'after');
    const existingCount = (photoType === 'evidence' || photoType === 'before') ? before.length : (photoType === 'pht' || photoType === 'after') ? after.length : 0;

    let done = 0;

    for (const source of files) {
      try {
        const sequenceIndex = existingCount + done + 1;
        const { filename, storagePath } = buildQueuedPhotoPath({
          techId,
          jobId: job.job_id || job.id,
          capturedAt: stamp.capturedAt,
          photoType,
          index: sequenceIndex,
        });

        // Compress with browser-image-compression — max 100KB, handles HEIC/HEIF
        let compressedFile: File;
        try {
          compressedFile = await imageCompression(source, {
            maxSizeMB: 0.1,
            maxWidthOrHeight: 1280,
            useWebWorker: true,
            fileType: 'image/jpeg',
            initialQuality: 0.7,
          });
        } catch (compressErr) {
          console.warn('[InlineTechPhotoManager] Compression failed, using original:', compressErr);
          compressedFile = source;
        }

        // Upload directly to Supabase Storage + insert into job_photos
        await uploadDirect(compressedFile, storagePath, photoType, String(job.id));

        createAuditLog({
          action: 'photo_upload_success',
          entity: 'job_photo',
          entityId: job.id,
          metadata: {
            tech_id: techId,
            job_id: job.job_id,
            photo_type: photoType,
            filename,
            size_kb: Math.round(compressedFile.size / 1024),
            summary: `Photo uploaded for job ${job.job_id}`,
          },
        }).catch(() => {});
      } catch (error) {
        console.error('Photo upload error:', error);
        alert(es ? `No se pudo subir una foto: ${error.message || error}` : `Could not upload one photo: ${error.message || error}`);
      }
      done += 1;
      setUploadProgress({ done, total, type: photoType, phase: 'upload' });
      await loadRemote();
    }

    setUploadProgress(null);
    e.target.value = '';
  };

  const deletePhoto = async (photo) => {
    setDeleting(photo.id);
    try {
      const url = new URL(photo.photo_url);
      const pathParts = url.pathname.split('/job-photos/');
      if (pathParts[1]) await sb.storage.from('job-photos').remove([pathParts[1]]);
      await sb.from('job_photos').delete().eq('id', photo.id);
    } catch (err) { console.error('Delete error:', err); }
    setDeleting(null);
    loadRemote();
  };

  const before = photos.filter((p) => p.photo_type === 'evidence' || p.photo_type === 'before' || !p.photo_type);
  const after = photos.filter((p) => p.photo_type === 'pht' || p.photo_type === 'after');

  const renderSection = (type, ps, label, color, fileRef, cameraRef) => {
    const isUploading = uploadProgress?.type === type;
    return (
      <div style={{ background: '#070f24', borderRadius: 10, border: `1px solid ${color}33`, overflow: 'hidden', marginBottom: 8 }}>
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => handleFiles(e, type)} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" multiple style={{ display: 'none' }} onChange={(e) => handleFiles(e, type)} />
        {lightboxIdx !== null && activeType === type && (
          <Lightbox photos={(type === 'evidence' || type === 'before') ? before : after} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: `1px solid ${color}22`, gap: 8 }}>
          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 1 }}>
            {label} {ps.length > 0 && `(${ps.length})`}
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button data-photo-camera-type={type} onClick={() => openCamera(type, cameraRef)} disabled={!!uploadProgress}
              style={{ background: isUploading ? color : `${color}22`, border: `1px solid ${color}66`, borderRadius: 6, padding: '5px 9px', color: isUploading ? '#04091c' : color, fontSize: 10, fontWeight: 800, cursor: uploadProgress ? 'not-allowed' : 'pointer', opacity: uploadProgress && !isUploading ? 0.4 : 1 }}>
              {isUploading ? `⏳ ${uploadProgress.done}/${uploadProgress.total}` : (es ? '📷 Cámara' : '📷 Camera')}
            </button>
            <button onClick={() => { setActiveType(type); fileRef.current?.click(); }} disabled={!!uploadProgress}
              style={{ background: '#0e1e3a', border: `1px solid ${color}55`, borderRadius: 6, padding: '5px 9px', color: '#dbe8ff', fontSize: 10, fontWeight: 800, cursor: uploadProgress ? 'not-allowed' : 'pointer', opacity: uploadProgress ? 0.4 : 1 }}>
              {es ? '🕒 Archivos' : '🕒 Files'}
            </button>
          </div>
        </div>
        {isUploading && (
          <div style={{ padding: '8px 12px', background: `${color}11` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color, fontWeight: 700 }}>
                {es ? `Subiendo ${uploadProgress.done}/${uploadProgress.total}...` : `Uploading ${uploadProgress.done}/${uploadProgress.total}...`}
              </span>
              <span style={{ fontSize: 10, color }}>{Math.round((uploadProgress.done / uploadProgress.total) * 100)}%</span>
            </div>
            <div style={{ height: 5, background: '#162e58', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(uploadProgress.done / uploadProgress.total) * 100}%`, background: color, borderRadius: 99, transition: 'width 0.25s ease' }} />
            </div>
          </div>
        )}
        {ps.length > 0 ? (
          <div style={{ padding: '8px 10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>
              {ps.map((p, i) => (
                <div key={p.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: `1px solid ${color}33`, aspectRatio: '1', background: '#0a1428' }}>
                  <img src={p.thumb_url || p.photo_url} alt={p.note || ''} loading="lazy" onClick={() => { setActiveType(type); setLightboxIdx(i); }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                    onError={(e) => { e.target.style.display = 'none'; }} />
                  <button onClick={() => deletePhoto(p)} disabled={deleting === p.id}
                    style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(255,51,72,0.85)', border: 'none', borderRadius: 4, width: 20, height: 20, color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, lineHeight: 1 }}>
                    {deleting === p.id ? '…' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px', textAlign: 'center', color: '#5a7aaa', fontSize: 11 }}>
            {es ? `Sin fotos ${(type === 'evidence' || type === 'before') ? 'antes' : 'después'} subidas` : `No uploaded ${(type === 'evidence' || type === 'before') ? 'before' : 'after'} photos`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 10 }}>
      {webcamType && (
        <div className="gfs-webcam-modal" style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(2,7,18,.92)',display:'grid',placeItems:'center',padding:16}}>
          <div style={{width:'min(720px,100%)',background:'#071327',border:'1px solid #1f4d80',borderRadius:18,padding:14,boxShadow:'0 24px 70px rgba(0,0,0,.55)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:10}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,color:'#e8f1ff'}}>📷 {(webcamType === 'evidence' || webcamType === 'before') ? (es ? 'Foto ANTES' : 'BEFORE photo') : (es ? 'Foto DESPUÉS' : 'AFTER photo')}</div>
              <button onClick={stopWebcam} style={{background:'#ff334822',border:'1px solid #ff334866',borderRadius:10,color:'#ff6677',fontWeight:900,padding:'8px 12px',cursor:'pointer'}}>✕</button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted style={{width:'100%',maxHeight:'62vh',background:'#020816',border:'1px solid #173b66',borderRadius:14,objectFit:'contain'}} />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:12}}>
              <button onClick={captureWebcamPhoto} style={{background:'#00dc85',border:'none',borderRadius:12,color:'#041018',fontWeight:950,padding:'13px 12px',cursor:'pointer'}}>{es ? 'Tomar foto' : 'Take photo'}</button>
              <button onClick={stopWebcam} style={{background:'#0e1e3a',border:'1px solid #1e3560',borderRadius:12,color:'#dbe8ff',fontWeight:900,padding:'13px 12px',cursor:'pointer'}}>{es ? 'Cancelar' : 'Cancel'}</button>
            </div>
          </div>
        </div>
      )}
      {webcamError && <div style={{background:'#ffbe0014',border:'1px solid #ffbe0066',borderRadius:10,padding:'8px 10px',marginBottom:8,color:'#ffcf55',fontSize:11,fontWeight:800}}>{webcamError}</div>}
      {renderSection('evidence', before, es ? '📷 ANTES' : '📷 BEFORE', '#ffbe00', fileRefBefore, cameraRefBefore)}
      {renderSection('pht', after, es ? '📷 DESPUÉS' : '📷 AFTER', '#00dc85', fileRefAfter, cameraRefAfter)}
    </div>
  );
}

export { InlineTechPhotoManager };
