import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Html5Qrcode } from 'html5-qrcode';

// ── ZXing Configuration ──
const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.QR_CODE,
]);
hints.set(DecodeHintType.TRY_HARDER, true);

const reader = new BrowserMultiFormatReader(hints);

// ── HTML5-QRCode (final fallback) ──
let html5QrCode = null;
function getScanner() {
  if (html5QrCode) return html5QrCode;
  let el = document.getElementById('dummy-h5qr');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dummy-h5qr';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  html5QrCode = new Html5Qrcode('dummy-h5qr');
  return html5QrCode;
}

function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

/**
 * Convert any image element to a grayscale (B&W) canvas image element.
 * Applies: grayscale + high contrast + brightness boost.
 */
function toBW(src, W, H) {
  const cvs = document.createElement('canvas');
  cvs.width  = W;
  cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.filter = 'grayscale(100%) contrast(1.8) brightness(1.1)';
  ctx.drawImage(src, 0, 0, W, H);
  return cvs;
}

async function tryScanZxing(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const result  = await reader.decodeFromImageUrl(dataUrl);
    if (result && result.getText()) return result.getText();
  } catch (_) {}
  return null;
}

async function tryScanHtml5(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const file    = dataURLtoFile(dataUrl, 'scan.jpg');
    const result  = await getScanner().scanFile(file, true);
    if (result) return result;
  } catch (_) {}
  return null;
}

/**
 * Scan an <img> element.
 *
 * Strategy:
 *  1. Native BarcodeDetector (hardware — fastest)
 *  2. Convert FULL image to B&W (grayscale + high contrast)
 *  3. Scan Top→Bottom strip (full width, y: 0%–50%)
 *  4. Scan Bottom→Top strip (full width, y: 50%–100%)
 *  5. Scan Full image (full width, full height)
 *  6. Rotate 90° and repeat steps 3-5 (sideways photos)
 *  7. Html5Qrcode on top strip B&W (robust fallback)
 */
export async function advancedScanImage(imageElement) {

  // ── 1. Native hardware detection (fastest on Android Chrome / iOS 17) ──
  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'upc_a', 'ean_8', 'upc_e'],
      });
      const hits = await detector.detect(imageElement);
      if (hits && hits.length > 0) {
        console.log('[Scanner] Native hit:', hits[0].rawValue);
        return hits[0].rawValue;
      }
    } catch (_) {}
  }

  const W = imageElement.naturalWidth  || imageElement.width  || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  // ── 2. Convert entire image to B&W with high contrast ──
  // Scale down so ZXing doesn't choke on giant images
  const scale = Math.min(1, 1200 / Math.max(W, H));
  const SW    = Math.round(W * scale);
  const SH    = Math.round(H * scale);

  const bwFull = toBW(imageElement, SW, SH);

  // ── 3-5. Scan regions from B&W full canvas ──
  const regions = [
    { name: 'Top 50%',    sx: 0, sy: 0,          sw: SW, sh: Math.round(SH * 0.50) },
    { name: 'Bottom 50%', sx: 0, sy: Math.round(SH * 0.50), sw: SW, sh: Math.round(SH * 0.50) },
    { name: 'Full',       sx: 0, sy: 0,          sw: SW, sh: SH },
  ];

  const regionCanvas = document.createElement('canvas');
  const rCtx = regionCanvas.getContext('2d', { willReadFrequently: true });

  for (const r of regions) {
    regionCanvas.width  = r.sw;
    regionCanvas.height = r.sh;
    rCtx.setTransform(1, 0, 0, 1, 0, 0);
    rCtx.filter = 'none';
    rCtx.drawImage(bwFull, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);

    let res = await tryScanZxing(regionCanvas);
    if (res) { console.log(`[ZXing B&W] ${r.name}`); return res; }
  }

  // ── 6. Rotate 90° (sideways photos) and repeat ──
  const bwRot = document.createElement('canvas');
  bwRot.width  = SH;
  bwRot.height = SW;
  const rCtx2 = bwRot.getContext('2d');
  rCtx2.translate(SH / 2, SW / 2);
  rCtx2.rotate(Math.PI / 2);
  rCtx2.drawImage(bwFull, -SW / 2, -SH / 2);

  const rotRegions = [
    { name: 'Rot Top 50%',    sx: 0, sy: 0,                    sw: SH, sh: Math.round(SW * 0.50) },
    { name: 'Rot Bottom 50%', sx: 0, sy: Math.round(SW * 0.50), sw: SH, sh: Math.round(SW * 0.50) },
    { name: 'Rot Full',       sx: 0, sy: 0,                    sw: SH, sh: SW },
  ];

  for (const r of rotRegions) {
    regionCanvas.width  = r.sw;
    regionCanvas.height = r.sh;
    rCtx.setTransform(1, 0, 0, 1, 0, 0);
    rCtx.filter = 'none';
    rCtx.drawImage(bwRot, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);

    let res = await tryScanZxing(regionCanvas);
    if (res) { console.log(`[ZXing B&W Rotated] ${r.name}`); return res; }
  }

  // ── 7. Html5Qrcode fallback on B&W top-half ──
  console.log('[Scanner] Html5Qrcode fallback on B&W');
  regionCanvas.width  = SW;
  regionCanvas.height = Math.round(SH * 0.50);
  rCtx.setTransform(1, 0, 0, 1, 0, 0);
  rCtx.filter = 'none';
  rCtx.drawImage(bwFull, 0, 0, SW, Math.round(SH * 0.50), 0, 0, SW, regionCanvas.height);
  let res = await tryScanHtml5(regionCanvas);
  if (res) { console.log('[Html5Qrcode] B&W Top hit'); return res; }

  // Html5Qrcode on full B&W
  regionCanvas.width  = SW;
  regionCanvas.height = SH;
  rCtx.setTransform(1, 0, 0, 1, 0, 0);
  rCtx.drawImage(bwFull, 0, 0, SW, SH);
  res = await tryScanHtml5(regionCanvas);
  if (res) { console.log('[Html5Qrcode] B&W Full hit'); return res; }

  console.log('[Scanner] All paths exhausted');
  return null;
}
