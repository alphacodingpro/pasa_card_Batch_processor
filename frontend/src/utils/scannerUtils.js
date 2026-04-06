import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
hints.set(DecodeHintType.TRY_HARDER, true);
const zxingReader = new BrowserMultiFormatReader(hints);

const yieldThread = () => new Promise(resolve => setTimeout(resolve, 0)); // Prevent freeze

// ── Optimization: Downscale huge images to max 1200px to stop UI lag
function normalizeImage(src) {
  const MAX_DIM = 1200;
  let w = src.naturalWidth || src.width;
  let h = src.naturalHeight || src.height;
  if (!w || !h) return null;

  if (w > MAX_DIM || h > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  return cvs;
}

// ── Helper: Draw enhanced cropped canvas
function generateCanvas(src, sx, sy, sw, sh, deg, scale = 1.0, filterType = 'normal') {
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const swapped = deg === 90 || deg === 270;

  // Pad 15% of the dimensions for quiet zones
  const pad = Math.round(Math.max(dw, dh) * 0.15);
  const cw = (swapped ? dh : dw) + (pad * 2);
  const ch = (swapped ? dw : dh) + (pad * 2);

  const c = document.createElement('canvas');
  c.width = Math.max(1, cw); c.height = Math.max(1, ch);
  if (c.width <= 1) return c; // Invalid dimensions guard
  const ctx = c.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((deg * Math.PI) / 180);

  if (filterType === 'contrast') {
    ctx.filter = 'grayscale(100%) contrast(200%) brightness(120%)';
  } else if (filterType === 'glare') {
    ctx.filter = 'grayscale(100%) contrast(250%) brightness(70%)';
  } else if (filterType === 'shadow') {
    ctx.filter = 'grayscale(100%) contrast(200%) brightness(180%)';
  }

  ctx.drawImage(src, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // Binarization only on the smaller generated canvas
  if (filterType.startsWith('threshold-')) {
    const thresholdVal = parseInt(filterType.split('-')[1], 10);
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = luma >= thresholdVal ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = val;
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
  // Pre-process: Downscale once! Fixes all lag.
  const normCvs = normalizeImage(imageElement);
  if (!normCvs) return null;

  const W = normCvs.width;
  const H = normCvs.height;

  // PASS 0: Fast native on full raw image
  let res = await nativeScan(imageElement);
  if (res) return res;

  // PASS 1: Native on normalized image
  res = await nativeScan(normCvs);
  if (res) return res;

  // Smart Regions: By combining all regions (Top, Bottom, Right, Left) regardless of camera
  // being held in portrait or landscape, we guarantee no label is missed due to photo orientation.
  const regions = [
    // Top and Bottom
    { name: 'Top', sx: 0, sy: 0, sw: W, sh: H * 0.9 },
    { name: 'Top 30', sx: 0, sy: 0, sw: W, sh: H * 0.4 },
    { name: 'Bottom', sx: 0, sy: H * 0.5, sw: W, sh: H * 0.5 },
    { name: 'Bottom 30', sx: 0, sy: H * 0.7, sw: W, sh: H * 0.3 },
    // Right and Left
    { name: 'Right', sx: W * 0.5, sy: 0, sw: W * 0.5, sh: H },
    { name: 'Right 30', sx: W * 0.7, sy: 0, sw: W * 0.3, sh: H },
    { name: 'Left', sx: 0, sy: 0, sw: W * 0.5, sh: H },
    { name: 'Left 30', sx: 0, sy: 0, sw: W * 0.3, sh: H },
    // Full Image
    { name: 'Full', sx: 0, sy: 0, sw: W, sh: H }
  ];

  const rotations = [0, 180, 90, 270];
  const filters = ['normal', 'contrast', 'threshold-128', 'threshold-170', 'glare'];

  // Bring back explicitly structured upscale factors. Wide lines scan infinitely better.
  const scales = [1.0, 1.5, 2.0];

  // FAST PASS: Native Engine Iteration
  for (const filter of filters) {
    for (const scale of scales) {
      for (const reg of regions) {
        for (const rot of rotations) {
          await yieldThread();
          const cvs = generateCanvas(normCvs, reg.sx, reg.sy, reg.sw, reg.sh, rot, scale, filter);
          res = await nativeScan(cvs);
          if (res) return res;
        }
      }
    }
  }

  // DEEP PASS: ZXing Fallback
  for (const filter of ['contrast', 'threshold-128']) {
    for (const scale of [1.5, 2.0]) {
      for (const reg of regions) {
        for (const rot of [0, 180]) { // ZXing handles some rotation internally
          await yieldThread();
          const cvs = generateCanvas(normCvs, reg.sx, reg.sy, reg.sw, reg.sh, rot, scale, filter);
          res = await zxingScan(cvs);
          if (res) return res;
        }
      }
    }
  }

  return null;
}