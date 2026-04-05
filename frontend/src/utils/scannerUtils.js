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

// Draw a region of imageElement onto canvas with a CSS filter
function drawRegion(canvas, ctx, imageElement, rx, ry, rw, rh, sw, sh, filter, rotate90) {
  if (rotate90) {
    canvas.width  = sh;
    canvas.height = sw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(sh / 2, sw / 2);
    ctx.rotate(Math.PI / 2);
    ctx.filter = filter;
    ctx.drawImage(imageElement, rx, ry, rw, rh, -sw / 2, -sh / 2, sw, sh);
  } else {
    canvas.width  = sw;
    canvas.height = sh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = filter;
    ctx.drawImage(imageElement, rx, ry, rw, rh, 0, 0, sw, sh);
  }
}

async function tryScanZxing(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const result  = await reader.decodeFromImageUrl(dataUrl);
    if (result && result.getText()) return result.getText();
  } catch (_) {}
  return null;
}

async function tryScanHtml5(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const file    = dataURLtoFile(dataUrl, 'scan.jpg');
    const result  = await getScanner().scanFile(file, true);
    if (result) return result;
  } catch (_) {}
  return null;
}

/**
 * Main export — scans an <img> element.
 * Strategy (fast → thorough):
 *   1. Native BarcodeDetector (hardware, instant)
 *   2. Top 40% strip — where PSA barcode always lives
 *   3. Full image (in case barcode is elsewhere)
 *   4. Same regions rotated 90° (sideways photos)
 *   5. Html5Qrcode on top-40% (robust fallback)
 */
export async function advancedScanImage(imageElement) {

  // ── 1. Native (fastest on supported devices) ──
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

  const isCroppedStrip = (W / H > 2.5) || (H / W > 2.5);

  // ── Regions ──
  // For a normal PSA photo: barcode is always in the top 35-40% of the image.
  // We check Top-40% first (most likely), then full image.
  const regions = isCroppedStrip
    ? [{ name: 'Full (Crop)', rx: 0, ry: 0, rw: W, rh: H }]
    : [
        { name: 'PSA Label Zone', rx: 0, ry: H * 0.05, rw: W, rh: H * 0.45 }, // 5%-50% — where label sits
        { name: 'Top 40%',        rx: 0, ry: 0,        rw: W, rh: H * 0.40 }, // in case label is at very top
        { name: 'Full',           rx: 0, ry: 0,        rw: W, rh: H        },
        { name: 'Bottom 40%',     rx: 0, ry: H * 0.60, rw: W, rh: H * 0.40 }, // upside-down cards
      ];

  // contrast filter: skip for already-cropped strips (avoid double-processing)
  const filters = isCroppedStrip
    ? ['none']
    : ['none', 'grayscale(100%) contrast(1.6) brightness(1.1)'];

  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d', { willReadFrequently: true });

  // ── 2 & 3. ZXing: horizontal then rotated 90° per region ──
  for (const region of regions) {
    const { rx, ry, rw, rh } = region;
    const scale = Math.min(1, 1200 / Math.max(rw, rh));
    const sw = Math.round(rw * scale);
    const sh = Math.round(rh * scale);

    for (const filter of filters) {
      // Horizontal
      drawRegion(canvas, ctx, imageElement, rx, ry, rw, rh, sw, sh, filter, false);
      let res = await tryScanZxing(canvas);
      if (res) { console.log(`[ZXing] ${region.name} H ${filter}`); return res; }

      // Rotated 90° (sideways photo)
      drawRegion(canvas, ctx, imageElement, rx, ry, rw, rh, sw, sh, filter, true);
      res = await tryScanZxing(canvas);
      if (res) { console.log(`[ZXing] ${region.name} 90° ${filter}`); return res; }
    }
  }

  // ── 4. Html5Qrcode fallback on top 40% ──
  console.log('[Scanner] Html5Qrcode fallback');
  const fScale = Math.min(1, 1000 / Math.max(W, H * 0.4));
  const fW = Math.round(W * fScale);
  const fH = Math.round(H * 0.4 * fScale);
  canvas.width  = fW;
  canvas.height = fH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.drawImage(imageElement, 0, 0, W, H * 0.4, 0, 0, fW, fH);
  let res = await tryScanHtml5(canvas);
  if (res) { console.log('[Html5Qrcode] Top 40% hit'); return res; }

  // Html5Qrcode on full image
  const fScaleFull = Math.min(1, 1000 / Math.max(W, H));
  canvas.width  = Math.round(W * fScaleFull);
  canvas.height = Math.round(H * fScaleFull);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
  res = await tryScanHtml5(canvas);
  if (res) { console.log('[Html5Qrcode] Full image hit'); return res; }

  console.log('[Scanner] All paths failed');
  return null;
}
