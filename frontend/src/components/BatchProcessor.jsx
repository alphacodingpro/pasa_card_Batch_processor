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
      queue.forEach(item => {
        if (item.status === 'pending') {
          processScan(item);
        } else if (item.status === 'camera_scanned') {
          // Immediately send to backend, skipping local JS image scan
          updateQueueItem(item.id, { status: 'process_backend' });
          sendToBackend(item.id, item.barcode);
        }
      });
    }
  }, [queue, autoProcess]);

  // ── Queue helpers ──────────────────────────────────────────
  const updateQueueItem = (id, updates) =>
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));

  // Determine API base URL (uses Vite proxy locally, and fully qualified URL in production)
  const renderHost = import.meta.env.VITE_API_URL || '';
  let fullUrl = renderHost;
  // If Render only provides the internal host (no dot), append the public domain
  if (renderHost && !renderHost.includes('.') && !renderHost.includes('localhost')) {
    fullUrl = `${renderHost}.onrender.com`;
  }
  const API_BASE = fullUrl ? (fullUrl.startsWith('http') ? fullUrl : `https://${fullUrl}`) : '';

  // ── Backend pipeline ───────────────────────────────────────
  const sendToBackend = async (id, barcode) => {
    try {
      // 1. Initiate backend processor
      const initRes = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      });
      if (!initRes.ok) throw new Error('API Error');
      const info = await initRes.json();

      let processId = info.id;

      // Instant cache hit
      if (info.cached) {
        updateQueueItem(id, {
          status: info.status === 'partial' ? 'partial' : 'done',
          resultData: info,
          barcode,
        });
        return;
      }

      // 2. Poll /status/{id}
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
  const processScan = async (item, overrideDataUrl = null) => {
    updateQueueItem(item.id, { status: 'scanning' });
    const img = new Image();
    img.src  = overrideDataUrl || item.dataUrl;
    await new Promise(r => { img.onload = r; });
    const result = await advancedScanImage(img);
    if (result) {
      updateQueueItem(item.id, { status: 'process_backend', barcode: result });
      await sendToBackend(item.id, result);
    } else {
      updateQueueItem(item.id, { status: 'error', error: 'Barcode not found — try cropping.' });
      // Show crop options automatically when image scanning fails
      openEditor(item);
    }
  };

  // ── Crop editor ────────────────────────────────────────────
  const openEditor  = (item) => { 
    setEditingItem(item); 
    // Auto-select the top PSA barcode area for 1-click convenience
    setCrop({ unit: '%', x: 5, y: 2, width: 90, height: 15 }); 
    setCompletedCrop(null); 
    setScanStatus(''); 
  };
  const closeEditor = ()     => setEditingItem(null);

  const getCroppedDataUrl = () => {
    let targetCrop = completedCrop;
    // Fallback to initial % crop if user didn't adjust handles
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
    
    // Add 40px white padding on all sides so barcode has the required "quiet zone" for ZXing
    const PADDING = 40;
    const cropW = targetCrop.width * sx;
    const cropH = targetCrop.height * sy;
    
    canvas.width  = cropW + (PADDING * 2);
    canvas.height = cropH + (PADDING * 2);
    
    const ctx = canvas.getContext('2d');
    
    // 1. Fill canvas with solid white (quiet zone)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 2. Massive contrast & sharpen boost so 1D barcodes become ultra crisp black/white
    ctx.filter = 'grayscale(100%) contrast(1.8) brightness(1.2)';
    
    // 3. Draw image in the center, leaving white border
    ctx.drawImage(
      image,
      targetCrop.x * sx, targetCrop.y * sy,
      cropW, cropH,
      PADDING, PADDING, cropW, cropH
    );
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
        <h2 style={{ color: 'white', margin: 0, fontSize: '1.2rem' }}>
          Processing Queue ({queue.length})
        </h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ccc', fontSize: '0.9rem', cursor: 'pointer' }}>
          <input 
            type="checkbox" 
            checked={autoProcess} 
            onChange={(e) => {
              setAutoProcess(e.target.checked);
              localStorage.setItem('psa_autoProcessing', e.target.checked);
            }} 
            style={{ width: '16px', height: '16px', accentColor: 'var(--accent-1)' }}
          />
          Auto-Process Scans
        </label>
      </div>

      <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '120px' }}>
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

      {/* ── Crop Editor Modal ─────────────────────────────── */}
      {editingItem && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.96)',
          display: 'flex', flexDirection: 'column', padding: '20px 20px 40px',
        }}>
          <div style={{ margin: '20px 0' }}>
            <h3 style={{ color: '#fff' }}>Crop Item</h3>
            <p style={{ color: '#aaa', fontSize: '0.9rem' }}>Isolate the barcode for better detection.</p>
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

      {/* ── Full-screen image modal ───────────────────────── */}
      {modalImg && (
        <div
          onClick={() => setModalImg(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.93)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
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

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '12px',
      border: `1px solid ${isDone ? 'rgba(74,222,128,0.2)' : isPartial ? 'rgba(251,191,36,0.2)' : isError ? 'rgba(248,113,113,0.2)' : 'var(--glass-border)'}`,
      overflow: 'hidden',
    }}>
      {/* ── Header row ─────── */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px' }}>
        <img
          src={(isDone || isPartial) && psa?.image_front_url ? psa.image_front_url : item.dataUrl}
          style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', flexShrink: 0 }}
          onClick={() => onImageClick((isDone || isPartial) && psa?.image_front_url ? psa.image_front_url : item.dataUrl)}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ color: '#fff', fontSize: '0.9rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.file_name}
          </strong>
          <span style={{
            fontSize: '0.8rem',
            color: isDone ? 'var(--success)' : isPartial ? 'var(--warning)' : isError ? 'var(--danger)' : '#aaa',
          }}>
            {item.status === 'pending'          && '⏳ Waiting for Action'}
            {item.status === 'scanning'         && '🔍 Finding Barcode…'}
            {item.status === 'process_backend'  && '🌐 Scraping PSA & PriceCharting…'}
            {isDone                             && `✅ ${item.barcode}`}
            {isPartial                          && `⚠️ Partial — ${item.barcode}`}
            {isError                            && `❌ ${item.error}`}
          </span>
        </div>
      </div>

      {/* ── Results Panel ─────── */}
      {(isDone || isPartial) && psa && (
        <div style={{ borderTop: '1px solid var(--glass-border)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* PSA Section */}
          <Section label="PSA">
            {/* Title + copy */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>{psa.title}</span>
              <button
                onClick={() => onCopy(psa.title)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '6px', padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0 }}
              >📋 Copy</button>
            </div>
            <Row label="Cert #"       value={psa.cert_number} />
            <Row label="Grade"        value={psa.item_grade} />
            <Row label="Population"   value={psa.psa_population} />
            <Row label="Estimate"     value={psa.psa_estimate} />
            <Row label="Last Sale"    value={psa.latest_sale_price && `${psa.latest_sale_price}${psa.latest_sale_date ? ' — ' + psa.latest_sale_date : ''}`} />
            {psa.psa_url && (
              <a href={psa.psa_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '0.8rem', marginTop: '2px', display: 'block' }}>
                View on PSA ↗
              </a>
            )}
          </Section>

          {/* PriceCharting Section */}
          {pc ? (
            <Section label="PriceCharting">
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                {pc.image_url && (
                  <img src={pc.image_url} style={{ width: '50px', height: '50px', objectFit: 'contain', borderRadius: '6px', cursor: 'pointer' }} onClick={() => onImageClick(pc.image_url)} />
                )}
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.85rem', flex: 1 }}>{pc.title}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px' }}>
                <PriceBox label="PSA 9"  data={pc.psa9_summary}  color="rgba(96,165,250,0.15)" />
                <PriceBox label="PSA 10" data={pc.psa10_summary} color="rgba(74,222,128,0.1)"  />
              </div>
              {pc.pricecharting_url && (
                <a href={pc.pricecharting_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '0.8rem', marginTop: '6px', display: 'block' }}>
                  PriceCharting
                </a>
              )}
            </Section>
          ) : (
            isPartial && (
              <Section label="PriceCharting">
                <span style={{ color: '#aaa', fontSize: '0.85rem' }}>⚠️ No PriceCharting data found for this card.</span>
              </Section>
            )
          )}

          {/* Extra eBay Links (rendered under PriceCharting per spec) */}
          {eb && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 12px' }}>
              <a href={eb.listings_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '0.85rem', textDecoration: 'underline' }}>
                PSA: Ebay Listings (ALL GRADES)
              </a>
              <a href={eb.sold_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '0.85rem', textDecoration: 'underline' }}>
                PSA: Ebay SOLD (ALL GRADES)
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Action Buttons ─────── */}
      {(item.status === 'pending' || item.status === 'error') && (
        <div style={{ display: 'flex', gap: '8px', padding: '0 12px 12px' }}>
          <button className="modern-btn" style={{ flex: 1, padding: '9px 12px', fontSize: '0.85rem', background: 'rgba(255,255,255,0.07)', color: '#fff' }} onClick={onOpenEditor}>
            ✂️ Crop & Scan
          </button>
          <button className="modern-btn primary-btn" style={{ flex: 1, padding: '9px 12px', fontSize: '0.85rem' }} onClick={onProcessAsIs}>
            🚀 Process As Is
          </button>
        </div>
      )}
    </div>
  );
}

// ── Small reusable UI atoms ──────────────────────────────────
function Section({ label, children }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px 12px' }}>
      <div style={{ color: '#888', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '3px' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#ddd' }}>{value}</span>
    </div>
  );
}

function PriceBox({ label, data = {}, color }) {
  const isNegative = data.change && data.change.toString().includes('-');
  return (
    <div style={{ background: color, border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '10px' }}>
      <div style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '4px', fontWeight: 600 }}>{label}</div>
      <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', marginBottom: '4px' }}>
        {data.price ? (data.price.toString().startsWith('$') ? data.price : `$${Number(data.price).toFixed(2)}`) : 'N/A'}
      </div>
      {data.change && (
         <div style={{ color: isNegative ? 'var(--danger)' : 'var(--success)', fontSize: '0.75rem', marginBottom: '2px' }}>
            change: {data.change}
         </div>
      )}
      {data.volume_display && (
         <div style={{ color: '#888', fontSize: '0.75rem' }}>
            {data.volume_display}
         </div>
      )}
    </div>
  );
}

function EbayBtn({ href, label, color = 'rgba(96,165,250,0.1)' }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        flex: 1, display: 'block', textAlign: 'center',
        background: color, border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px', padding: '8px 6px',
        color: '#ddd', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 500,
      }}
    >{label}</a>
  );
}
