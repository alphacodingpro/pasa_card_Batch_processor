import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

// Reader with Code128/Code39 hints (PSA uses Code128)
const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
]);
hints.set(DecodeHintType.TRY_HARDER, true);

const reader = new BrowserMultiFormatReader(hints);

async function tryScan(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const result  = await reader.decodeFromImageUrl(dataUrl);
    if (result && result.getText()) return result.getText();
  } catch (_) {}
  return null;
}

/**
 * Scan an <img> element. Returns barcode string or null.
 */
export async function advancedScanImage(imageElement) {

  // ── Fast path: native hardware BarcodeDetector ──
  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'ean_8', 'upc_e'],
      });
      const hits = await detector.detect(imageElement);
      if (hits && hits.length > 0) {
        console.log('[Scanner] Native hit:', hits[0].rawValue);
        return hits[0].rawValue;
      }
    } catch (_) {}
  }

  // ── ZXing fallback ──
  const W = imageElement.naturalWidth  || imageElement.width  || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d', { willReadFrequently: true });

  // Keep max dimension at 1200 px for ZXing precision
  const scale = Math.min(1, 1200 / Math.max(W, H));
  const sw = Math.round(W * scale);
  const sh = Math.round(H * scale);

  // Multiple filter passes: raw → mild → heavy contrast
  const filters = [
    'none',
    'grayscale(100%) contrast(1.5)',
    'grayscale(100%) contrast(2.5) brightness(1.15)',
  ];

  for (const filter of filters) {
    // Normal orientation
    canvas.width  = sw;
    canvas.height = sh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = filter;
    ctx.drawImage(imageElement, 0, 0, sw, sh);
    let res = await tryScan(canvas);
    if (res) { console.log('[Scanner] Normal:', filter); return res; }

    // 90° rotation (handles portrait-held-phone images)
    canvas.width  = sh;
    canvas.height = sw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(sh / 2, sw / 2);
    ctx.rotate(Math.PI / 2);
    ctx.filter = filter;
    ctx.drawImage(imageElement, -sw / 2, -sh / 2, sw, sh);
    res = await tryScan(canvas);
    if (res) { console.log('[Scanner] Rotated 90°:', filter); return res; }
  }

  console.log('[Scanner] All passes failed');
  return null;
}
