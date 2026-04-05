import { useState, useRef, useEffect } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { advancedScanImage } from '../utils/scannerUtils';

export default function BatchProcessor({ queue, setQueue }) {
  const [editingItem, setEditingItem]     = useState(null);
  const [crop, setCrop]                   = useState(null);
  const [completedCrop, setCompletedCrop] = useState(null);
  const [scanStatus, setScanStatus]       = useState('');
  const [modalImg, setModalImg]           = useState(null);
  const [autoProcess, setAutoProcess]     = useState(() => localStorage.getItem('psa_autoProcessing') === 'true');
  const imgRef = useRef(null);

  useEffect(() => {
    if (autoProcess) {
      const pending       = queue.filter(item => item.status === 'pending');
      const cameraScanned = queue.filter(item => item.status === 'camera_scanned');
      if (pending.length > 0) {
        Promise.all(pending.map(item => processScan(item)));
      }
      cameraScanned.forEach(item => {
        updateQueueItem(item.id, { status: 'process_backend' });
        sendToBackend(item.id, item.barcode);
      });
    }
  }, [queue, autoProcess]);

  // ── Queue helpers ──────────────────────────────────────────
  const updateQueueItem = (id, updates) =>
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));

  const renderHost = import.meta.env.VITE_API_URL || '';
  let fullUrl = renderHost;
  if (renderHost && !renderHost.includes('.') && !renderHost.includes('localhost')) {
    fullUrl = `${renderHost}.onrender.com`;
  }
  const API_BASE = fullUrl ? (fullUrl.startsWith('http') ? fullUrl : `https://${fullUrl}`) : '';

  // ── Backend pipeline ───────────────────────────────────────
  const sendToBackend = async (id, barcode) => {
    try {
      const initRes = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      });
      if (!initRes.ok) throw new Error('API Error');
      const info = await initRes.json();
      let processId = info.id;

      if (info.cached) {
        updateQueueItem(id, {
          status: info.status === 'partial' ? 'partial' : 'done',
          resultData: info,
          barcode,
        });
        return;
      }

      while (true) {
        await new Promise(r => setTimeout(r, 2500));
        const sRes  = await fetch(`${API_BASE}/status/${processId}`);
        const sData = await sRes.json();
        if (sData.status === 'complete') {
          updateQueueItem(id, { status: 'done', resultData: sData, barcode });
          break;
        } else if (sData.status === 'partial') {
          updateQueueItem(id, { status: 'partial', resultData: sData, barcode });
          break;
        } else if (sData.status === 'error') {
          updateQueueItem(id, { status: 'error', error: sData.error_message });
          break;
        }
      }
    } catch (err) {
      console.error(err);
      const urlInfo = `(URL: ${API_BASE || 'local'})`;
      updateQueueItem(id, { status: 'error', error: `❌ Network Error: Check Server connection. ${urlInfo}` });
    }
  };

  // ── Scan logic ─────────────────────────────────────────────
  const extractStrip = async (img, yPct, hPct) => {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    const cvs = document.createElement('canvas');
    cvs.width  = W;
    cvs.height = Math.round(H * hPct);
    const cx = cvs.getContext('2d');
    cx.drawImage(img, 0, Math.round(H * yPct), W, cvs.height, 0, 0, W, cvs.height);
    return new Promise(r => {
      const si = new Image();
      si.onload = () => r(si);
      si.src = cvs.toDataURL('image/jpeg', 0.95);
    });
  };

  const processScan = async (item, overrideDataUrl = null) => {
    updateQueueItem(item.id, { status: 'scanning' });
    const img = new Image();
    img.src = overrideDataUrl || item.dataUrl;
    await new Promise(r => { img.onload = r; });

    let result = null;
    if (!overrideDataUrl) {
      try { const topStrip = await extractStrip(img, 0.05, 0.42); result = await advancedScanImage(topStrip); } catch (_) {}
      if (!result) {
        try { const botStrip = await extractStrip(img, 0.53, 0.42); result = await advancedScanImage(botStrip); } catch (_) {}
      }
      if (!result) { result = await advancedScanImage(img); }
    } else {
      result = await advancedScanImage(img);
    }

    if (result) {
      updateQueueItem(item.id, { status: 'process_backend', barcode: result });
      await sendToBackend(item.id, result);
    } else {
      updateQueueItem(item.id, { status: 'error', error: 'Barcode not found. Retry or check image.' });
    }
  };

  // ── Crop editor ────────────────────────────────────────────
  const openEditor  = (item) => {
    setEditingItem(item);
    setCrop({ unit: '%', x: 0, y: 8, width: 100, height: 40 });
    setCompletedCrop(null);
    setScanStatus('');
  };
  const closeEditor = () => setEditingItem(null);

  const getCroppedDataUrl = () => {
    let targetCrop = completedCrop;
    if (!targetCrop?.width && crop && imgRef.current) {
      targetCrop = {
        x: (crop.x * imgRef.current.width) / 100,
        y: (crop.y * imgRef.current.height) / 100,
        width: (crop.width * imgRef.current.width) / 100,
        height: (crop.height * imgRef.current.height) / 100,
      };
    }
    if (!targetCrop?.width || !imgRef.current) return editingItem.dataUrl;
    const image  = imgRef.current;
    const canvas = document.createElement('canvas');
    const sx = image.naturalWidth  / image.width;
    const sy = image.naturalHeight / image.height;
    const PADDING = 40;
    const cropW = targetCrop.width * sx;
    const cropH = targetCrop.height * sy;
    canvas.width  = cropW + (PADDING * 2);
    canvas.height = cropH + (PADDING * 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = 'grayscale(100%) contrast(1.8) brightness(1.2)';
    ctx.drawImage(image, targetCrop.x * sx, targetCrop.y * sy, cropW, cropH, PADDING, PADDING, cropW, cropH);
    return canvas.toDataURL('image/jpeg', 1.0);
  };

  const handleManualScan = async () => {
    setScanStatus('Scanning…');
    await processScan(editingItem, getCroppedDataUrl());
    closeEditor();
  };

  const rotateEditorImage = () => {
    if (!imgRef.current) return;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const img = imgRef.current;
    c.width  = img.naturalHeight;
    c.height = img.naturalWidth;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    setEditingItem({ ...editingItem, dataUrl: c.toDataURL('image/jpeg', 0.9) });
  };

  const copyText = (text) => navigator.clipboard.writeText(text).catch(() => {});

  if (queue.length === 0) return null;

  return (
    <div className="batch-processor">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ color: 'white', margin: 0, fontSize: '1.1rem' }}>
          Queue ({queue.length})
        </h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ccc', fontSize: '0.82rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoProcess}
            onChange={(e) => {
              setAutoProcess(e.target.checked);
              localStorage.setItem('psa_autoProcessing', e.target.checked);
            }}
            style={{ width: '16px', height: '16px', accentColor: 'var(--accent-1)' }}
          />
          Auto-Process
        </label>
      </div>

      <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '120px' }}>
        {queue.map(item => (
          <QueueCard
            key={item.id}
            item={item}
            onOpenEditor={() => openEditor(item)}
            onProcessAsIs={() => processScan(item)}
            onImageClick={(url) => setModalImg(url)}
            onCopy={copyText}
          />
        ))}
      </div>

      {/* ── Crop Editor Modal */}
      {editingItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.96)', display: 'flex', flexDirection: 'column', padding: '20px 20px 40px' }}>
          <div style={{ margin: '20px 0' }}>
            <h3 style={{ color: '#fff' }}>Crop & Scan</h3>
            <p style={{ color: '#aaa', fontSize: '0.85rem' }}>Isolate the barcode area for best results.</p>
          </div>
          <div style={{ flex: 1, background: '#111', borderRadius: '12px', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px' }}>
            <ReactCrop crop={crop} onChange={(_, pc) => setCrop(pc)} onComplete={c => setCompletedCrop(c)} style={{ maxWidth: '100%' }}>
              <img ref={imgRef} src={editingItem.dataUrl} style={{ width: '100%', maxWidth: '500px', height: 'auto', objectFit: 'contain' }} />
            </ReactCrop>
          </div>
          {scanStatus && <div style={{ color: 'var(--warning)', textAlign: 'center', margin: '14px 0' }}>{scanStatus}</div>}
          <div style={{ display: 'flex', gap: '12px', marginTop: '18px' }}>
            <button className="modern-btn secondary-btn" onClick={rotateEditorImage} style={{ padding: '10px 18px' }}>↻</button>
            <button className="modern-btn return-btn" style={{ flex: 1 }} onClick={closeEditor}>Cancel</button>
            <button className="modern-btn primary-btn" style={{ flex: 2 }} onClick={handleManualScan}>Scan Selected</button>
          </div>
        </div>
      )}

      {/* ── Full-screen image modal */}
      {modalImg && (
        <div onClick={() => setModalImg(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={modalImg} style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: '12px', boxShadow: '0 0 60px rgba(0,0,0,0.8)' }} />
        </div>
      )}
    </div>
  );
}

// ── Individual Queue Card ──────────────────────────────────────
function QueueCard({ item, onOpenEditor, onProcessAsIs, onImageClick, onCopy }) {
  const rd  = item.resultData;
  const psa = rd?.psa;
  const pc  = rd?.pricecharting;
  const eb  = rd?.ebay;

  const isDone    = item.status === 'done';
  const isPartial = item.status === 'partial';
  const isError   = item.status === 'error';
  const hasResult = (isDone || isPartial) && psa;

  const fmt = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return `$${v.toFixed(2)}`;
    return String(v).startsWith('$') ? v : `$${v}`;
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '14px',
      border: `1px solid ${isDone ? 'rgba(74,222,128,0.25)' : isPartial ? 'rgba(251,191,36,0.25)' : isError ? 'rgba(248,113,113,0.25)' : 'var(--glass-border)'}`,
      overflow: 'hidden',
      fontSize: '0.82rem',
    }}>

      {/* 3 images at top */}
      {hasResult && (
        <div style={{ display: 'flex', gap: '5px', padding: '8px 8px 0' }}>
          {item.dataUrl && (
            <div style={{ position: 'relative', flex: 1 }}>
              <img src={item.dataUrl} onClick={() => onImageClick(item.dataUrl)}
                style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '7px', cursor: 'pointer', display: 'block' }} />
            </div>
          )}
          {psa?.image_front_url && (
            <div style={{ position: 'relative', flex: 1 }}>
              <img src={psa.image_front_url} onClick={() => onImageClick(psa.image_front_url)}
                style={{ width: '100%', height: '80px', objectFit: 'contain', borderRadius: '7px', cursor: 'pointer', background: '#161630', display: 'block' }} />
              <span style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', background: '#1e3a8a', color: '#fff', fontSize: '0.58rem', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.04em' }}>PSA</span>
            </div>
          )}
          {pc?.image_url && (
            <div style={{ position: 'relative', flex: 1 }}>
              <img src={pc.image_url} onClick={() => onImageClick(pc.image_url)}
                style={{ width: '100%', height: '80px', objectFit: 'contain', borderRadius: '7px', cursor: 'pointer', background: '#0f1f0f', display: 'block' }} />
              <span style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', background: '#14532d', color: '#fff', fontSize: '0.58rem', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.04em' }}>PC</span>
            </div>
          )}
        </div>
      )}

      {/* Header: filename + status badge */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: hasResult ? '7px 8px 5px' : '10px 10px' }}>
        {!hasResult && item.dataUrl && (
          <img src={item.dataUrl} onClick={() => onImageClick(item.dataUrl)}
            style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ color: '#e2e8f0', fontSize: '0.79rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.file_name}
          </strong>
          <span style={{ fontSize: '0.73rem', color: isDone ? 'var(--success)' : isPartial ? 'var(--warning)' : isError ? 'var(--danger)' : '#888' }}>
            {item.status === 'pending'         && '⏳ Waiting…'}
            {item.status === 'scanning'        && '🔍 Scanning…'}
            {item.status === 'process_backend' && '🌐 Fetching data…'}
            {isDone                            && `✅ ${item.barcode}`}
            {isPartial                         && `⚠️ Partial — ${item.barcode}`}
            {isError                           && `❌ ${item.error}`}
          </span>
        </div>
        {isDone    && <Badge label="Done"    bg="rgba(74,222,128,0.15)"  color="var(--success)" border="rgba(74,222,128,0.3)" />}
        {isPartial && <Badge label="Partial" bg="rgba(251,191,36,0.15)" color="var(--warning)" border="rgba(251,191,36,0.3)" />}
      </div>

      {/* Results */}
      {hasResult && (
        <div style={{ padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* PSA */}
          <div>
            <SectionLabel>PSA</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', margin: '4px 0 6px' }}>
              <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.83rem', flex: 1, lineHeight: 1.3 }}>{psa.title}</span>
              <button onClick={() => onCopy(psa.title)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#888', borderRadius: '4px', padding: '2px 6px', fontSize: '0.68rem', cursor: 'pointer', flexShrink: 0 }}>
                📋
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: '6px' }}>
              <DataCell label="CERT #"     value={psa.cert_number}   accent copyable onCopy={onCopy} />
              <DataCell label="GRADE"      value={psa.item_grade} />
              <DataCell label="PSA EST."   value={psa.psa_estimate || '—'} />
              <DataCell label="POPULATION" value={psa.psa_population} />
            </div>
            {psa.latest_sale_price && (
              <div style={{ fontSize: '0.76rem', marginBottom: '7px' }}>
                <span style={{ color: '#888', marginRight: '5px' }}>LATEST SALE</span>
                <span style={{ color: '#4ade80', fontWeight: 700 }}>{psa.latest_sale_price}</span>
                {psa.latest_sale_date && <span style={{ color: '#666', marginLeft: '5px' }}>· {psa.latest_sale_date}</span>}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {psa.psa_url        && <Pill href={psa.psa_url}        label="PSA"       bg="#1e3a8a" />}
              {eb?.listings_url   && <Pill href={eb.listings_url}    label="eBay Ask"  bg="#78350f" />}
              {eb?.sold_url       && <Pill href={eb.sold_url}        label="eBay Sold" bg="#431407" />}
            </div>
          </div>

          {/* Divider */}
          {pc && <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />}

          {/* PriceCharting */}
          {pc ? (
            <div>
              <SectionLabel>PriceCharting</SectionLabel>
              <div style={{ color: '#666', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '3px 0 6px' }}>Market Summary</div>

              {pc.psa9_summary?.price && (
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                  <div style={{ width: '44px', flexShrink: 0 }}>
                    <div style={{ color: '#666', fontSize: '0.62rem', textTransform: 'uppercase' }}>GRADE</div>
                    <div style={{ color: '#cbd5e1', fontWeight: 700, fontSize: '0.84rem' }}>9</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.88rem' }}>{fmt(pc.psa9_summary.price)}</div>
                    {pc.psa9_summary.volume_display && <div style={{ color: '#777', fontSize: '0.7rem' }}>{pc.psa9_summary.volume_display}</div>}
                  </div>
                  {pc.psa9_summary.change != null && (
                    <div style={{ color: (typeof pc.psa9_summary.change === 'number' ? pc.psa9_summary.change : parseFloat(pc.psa9_summary.change)) < 0 ? '#f87171' : '#4ade80', fontWeight: 600, fontSize: '0.78rem', flexShrink: 0 }}>
                      {(typeof pc.psa9_summary.change === 'number' ? pc.psa9_summary.change : parseFloat(pc.psa9_summary.change)) > 0 ? '+' : ''}{fmt(pc.psa9_summary.change)}
                    </div>
                  )}
                </div>
              )}

              {pc.psa10_summary?.price && (
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '7px' }}>
                  <div style={{ width: '44px', flexShrink: 0 }}>
                    <div style={{ color: '#666', fontSize: '0.62rem', textTransform: 'uppercase' }}>PSA</div>
                    <div style={{ color: '#cbd5e1', fontWeight: 700, fontSize: '0.84rem' }}>10</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.88rem' }}>{fmt(pc.psa10_summary.price)}</div>
                    {pc.psa10_summary.volume_display && <div style={{ color: '#777', fontSize: '0.7rem' }}>{pc.psa10_summary.volume_display}</div>}
                  </div>
                  {pc.psa10_summary.change != null && (
                    <div style={{ color: (typeof pc.psa10_summary.change === 'number' ? pc.psa10_summary.change : parseFloat(pc.psa10_summary.change)) < 0 ? '#f87171' : '#4ade80', fontWeight: 600, fontSize: '0.78rem', flexShrink: 0 }}>
                      {(typeof pc.psa10_summary.change === 'number' ? pc.psa10_summary.change : parseFloat(pc.psa10_summary.change)) > 0 ? '+' : ''}{fmt(pc.psa10_summary.change)}
                    </div>
                  )}
                </div>
              )}

              {pc.pricecharting_url && <Pill href={pc.pricecharting_url} label="PriceCharting" bg="#14532d" />}
            </div>
          ) : isPartial && (
            <div style={{ color: '#666', fontSize: '0.76rem' }}>⚠️ No PriceCharting data found.</div>
          )}
        </div>
      )}

      {/* Retry button */}
      {(item.status === 'pending' || item.status === 'error') && (
        <div style={{ padding: '0 8px 8px' }}>
          <button className="modern-btn primary-btn" style={{ width: '100%', padding: '8px', fontSize: '0.8rem' }} onClick={onProcessAsIs}>
            🔄 Retry Scan
          </button>
        </div>
      )}
    </div>
  );
}

// ── Atoms ─────────────────────────────────────────────────────
function Badge({ label, bg, color, border }) {
  return (
    <span style={{ fontSize: '0.68rem', background: bg, color, border: `1px solid ${border}`, borderRadius: '20px', padding: '2px 9px', flexShrink: 0 }}>
      {label}
    </span>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ color: '#6b85c8', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </div>
  );
}

function DataCell({ label, value, accent, copyable, onCopy }) {
  return (
    <div>
      <div style={{ color: '#555', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        <span style={{ color: accent ? '#93c5fd' : '#cbd5e1', fontSize: '0.8rem', fontWeight: accent ? 600 : 400 }}>
          {value || '—'}
        </span>
        {copyable && value && onCopy && (
          <button onClick={() => onCopy(value)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, fontSize: '0.62rem' }}>
            📋
          </button>
        )}
      </div>
    </div>
  );
}

function Pill({ href, label, bg }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: `${bg}55`, border: `1px solid ${bg}99`,
        color: '#e2e8f0', fontSize: '0.7rem', fontWeight: 500,
        padding: '3px 10px', borderRadius: '20px',
        textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
      {label} ↗
    </a>
  );
}
