import { Html5Qrcode } from 'html5-qrcode';

// ── Html5Qrcode setup ──
let _h5 = null;
function getH5Scanner() {
  if (_h5) return _h5;
  let el = document.getElementById('_psa_h5qr');
  if (!el) {
    el = document.createElement('div');
    el.id = '_psa_h5qr';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  _h5 = new Html5Qrcode('_psa_h5qr');
  return _h5;
}

async function tryScanHtml5(canvas) {
  try {
    const url = canvas.toDataURL('image/png');
    const arr = url.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const b = atob(arr[1]);
    const u8 = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
    const file = new File([u8], 'scan.png', { type: mime });
    const res = await getH5Scanner().scanFile(file, true);
    return res || null;
  } catch (_) { return null; }
}

// Canvas pe region draw karo — multiple rotations support ke saath
function drawRegion(canvas, ctx, img, sx, sy, sw, sh, dw, dh, rotationDegrees) {
  canvas.width = dw;
  canvas.height = dh;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  
  if (rotationDegrees === 180) {
    ctx.translate(dw, dh);
    ctx.rotate(Math.PI);
  } else if (rotationDegrees === 90) {
    canvas.width = dh;
    canvas.height = dw;
    ctx.translate(dh, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotationDegrees === 270) {
    canvas.width = dh;
    canvas.height = dw;
    ctx.translate(0, dw);
    ctx.rotate(-Math.PI / 2);
  }
  
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
}

/**
 * PSA Card barcode scanner — Optimized for 1D Code 128
 * Har region ko multiple rotations aur scales par check karta hai.
 */
export async function advancedScanImage(imageElement) {

  // ── 1. Native BarcodeDetector — Desktop/Android/iOS high-end ──
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'ean_8'],
      });
      const hits = await det.detect(imageElement);
      if (hits?.length > 0) return hits[0].rawValue;
    } catch (_) { }
  }

  const W = imageElement.naturalWidth || imageElement.width || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // ── Optimization parameters ──
  const regionDefs = [
    ['top-strip',    0.00, 0.00, 1.00, 0.18], // Label at top (Most common)
    ['bottom-strip', 0.00, 0.72, 1.00, 0.28], // Label at bottom
    ['full',         0.00, 0.00, 1.00, 1.00], // Full image fallback
  ];

  const filters = [
    'none',
    'grayscale(100%) contrast(1.6) brightness(1.1)',
    'grayscale(100%) contrast(2.5) brightness(1.2)',
  ];

  const rotations = [0, 180, 90, 270];
  const scales    = [2.0, 1.0, 3.0]; // Try zooming in first

  // ── Main Scanning Logic ──
  for (const filter of filters) {
    ctx.filter = filter;

    for (const scaleFactor of scales) {
      for (const rotation of rotations) {
        for (const [name, xf, yf, wf, hf] of regionDefs) {
          const sx = Math.round(W * xf);
          const sy = Math.round(H * yf);
          const sw = Math.round(W * wf);
          const sh = Math.round(H * hf);

          // Preserve quality for Code 128 bars. Max 2200px.
          const finalScale = Math.min(scaleFactor, 2200 / Math.max(sw, sh));
          const dw = Math.round(sw * finalScale);
          const dh = Math.round(sh * finalScale);

          drawRegion(canvas, ctx, imageElement, sx, sy, sw, sh, dw, dh, rotation);
          
          const res = await tryScanHtml5(canvas);
          if (res) {
            console.log(`[Scanner] ✓ FOUND! | ${name} | Rot:${rotation} | Scale:${scaleFactor} | ${filter}`);
            return res;
          }
        }
      }
    }
  }

  console.log('[Scanner] All engines and combinations failed');
  return null;
}