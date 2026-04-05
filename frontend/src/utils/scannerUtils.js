// ─────────────────────────────────────────────────────────────
//  PSA Barcode Scanner – Ultimate Canvas Strategy
//
//  This pipeline uses pure Canvas API manipulation (no heavy OpenCV)
//  to solve glare, shadows, blur, and angles, maximizing accuracy.
//
//  Strategy:
//  1. Native API first (Fastest)
//  2. Multi-Rotation + Padding on crops
//  3. Image Enhancement Filters (Glare fixed, shadows lightened)
//  4. ZXing Fallback with same enhancements
// ─────────────────────────────────────────────────────────────

import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

// ── Configuration ────────────────────────────────────────────
const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
hints.set(DecodeHintType.TRY_HARDER, true);
const zxingReader = new BrowserMultiFormatReader(hints);

// ── Helper: Draw enhanced cropped canvas ─────────────────────
function generateCanvas(src, sx, sy, sw, sh, deg, scale, filterType = 'normal') {
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const swapped = deg === 90 || deg === 270;
  
  // Add 15% white padding - ZXing needs quiet zones around barcodes!
  const pad = Math.round(Math.max(dw, dh) * 0.15); 
  const cw = (swapped ? dh : dw) + (pad * 2);
  const ch = (swapped ? dw : dh) + (pad * 2);

  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  
  // Fill quiet zone with white
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((deg * Math.PI) / 180);
  
  // CSS Filters
  if (filterType === 'contrast') {
    ctx.filter = 'grayscale(100%) contrast(200%) brightness(120%)';
  } else if (filterType === 'glare') {
    ctx.filter = 'grayscale(100%) contrast(250%) brightness(70%)';
  } else if (filterType === 'shadow') {
    ctx.filter = 'grayscale(100%) contrast(200%) brightness(180%)';
  }

  ctx.drawImage(src, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // Manual Binarization (Thresholding)
  if (filterType.startsWith('threshold-')) {
    const thresholdVal = parseInt(filterType.split('-')[1], 10);
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      // Perceived luminance
      const luma = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const val = luma >= thresholdVal ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return c;
}

// ── Native Scanner Wrapper ───────────────────────────────────
let _nativeDet = null;
function getNativeDetector() {
  if (_nativeDet === undefined) return null;
  if (_nativeDet) return _nativeDet;
  if (!('BarcodeDetector' in window)) { _nativeDet = undefined; return null; }
  try {
    _nativeDet = new window.BarcodeDetector({ formats: ['code_128', 'code_39'] });
  } catch (e) {
    _nativeDet = new window.BarcodeDetector();
  }
  return _nativeDet;
}

async function nativeScan(canvasOrImg) {
  const det = getNativeDetector();
  if (!det) return null;
  try {
    const hits = await det.detect(canvasOrImg);
    return hits?.length ? hits[0].rawValue : null;
  } catch { return null; }
}

async function zxingScan(canvas) {
  try {
    const res = await zxingReader.decodeFromCanvas(canvas);
    return res.getText();
  } catch (e) { return null; }
}

// ── Main Scan Execution ──────────────────────────────────────
export async function advancedScanImage(imageElement) {
  const W = imageElement.naturalWidth  || imageElement.width  || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  // PASS 0: Fast native try
  let res = await nativeScan(imageElement);
  if (res) return res;

  // Define smart regions based on orientation.
  // Expanded logic: Catch smaller barcodes by adding tighter regions.
  const isLandscape = W > H;
  const regions = isLandscape ? [
    { name: 'Right', sx: W * 0.55, sy: 0, sw: W * 0.45, sh: H },
    { name: 'Left',  sx: 0,        sy: 0, sw: W * 0.45, sh: H },
    { name: 'Top',   sx: 0,        sy: 0, sw: W,        sh: H * 0.40 }
  ] : [
    { name: 'Top',    sx: 0, sy: 0,        sw: W, sh: H * 0.40 },
    { name: 'Bottom', sx: 0, sy: H * 0.60, sw: W, sh: H * 0.40 },
    { name: 'Right',  sx: W * 0.55, sy: 0, sw: W * 0.45, sh: H }
  ];

  const rotations = [0, 180, 90, 270];
  
  // Adjusted scales: 1.5 is critical for very high-res photos where 3.5 creates blur.
  const scales = [1.5, 2.5, 3.5]; 
  
  // Advanced filter matrix: added pure black & white thresholds
  const filters = ['normal', 'contrast', 'threshold-128', 'threshold-90', 'threshold-170', 'glare', 'shadow'];

  // PASS 1: Native Engine Iteration
  for (const filter of filters) {
    for (const scale of scales) {
      for (const reg of regions) {
        for (const rot of rotations) {
          const cvs = generateCanvas(imageElement, reg.sx, reg.sy, reg.sw, reg.sh, rot, scale, filter);
          res = await nativeScan(cvs);
          if (res) return res;
        }
      }
    }
  }

  // PASS 2: ZXing Fallback (Robust but slower)
  for (const filter of ['contrast', 'threshold-128']) {
    for (const scale of [1.5, 2.5]) {
      for (const reg of regions) {
        for (const rot of [0, 90]) {
          const cvs = generateCanvas(imageElement, reg.sx, reg.sy, reg.sw, reg.sh, rot, scale, filter);
          res = await zxingScan(cvs);
          if (res) return res;
        }
      }
    }
  }

  return null; // All attempts failed
}