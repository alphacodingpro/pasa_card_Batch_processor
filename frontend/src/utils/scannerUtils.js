import { Html5Qrcode } from 'html5-qrcode';
import cv from '@techstark/opencv-js';

// ── OpenCV Readiness ──
let cvReady = false;
const checkCV = () => {
    if (cvReady) return true;
    try {
        if (cv.Mat) { cvReady = true; return true; }
    } catch (e) {}
    return false;
};

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

// ── Pro Pre-processing (OpenCV) ──
function getWarpedLabel(imageElement) {
    if (!checkCV()) return null;

    let src = cv.imread(imageElement);
    let hsv = new cv.Mat();
    let mask = new cv.Mat();
    let result = null;

    try {
        // PSA Red detection
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // Define PSA Red range (two ranges for wrap-around red)
        let low1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 70, 50, 0]);
        let high1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [10, 255, 255, 0]);
        let low2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [160, 70, 50, 0]);
        let high2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 0]);

        let mask1 = new cv.Mat();
        let mask2 = new cv.Mat();
        cv.inRange(hsv, low1, high1, mask1);
        cv.inRange(hsv, low2, high2, mask2);
        cv.add(mask1, mask2, mask);

        // Clean mask
        let M = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, M);
        
        // Find Largest Red Contour
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestIdx = -1;
        for (let i = 0; i < contours.size(); ++i) {
            let area = cv.contourArea(contours.get(i));
            if (area > maxArea) { maxArea = area; bestIdx = i; }
        }

        if (bestIdx !== -1 && maxArea > (src.rows * src.cols * 0.01)) {
            let cnt = contours.get(bestIdx);
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            if (approx.rows === 4) {
                // Perspective Warp
                let points = [];
                for (let i = 0; i < 4; i++) points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
                
                // Sort points: top-left, top-right, bottom-right, bottom-left
                points.sort((a, b) => a.y - b.y);
                let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
                let bottom = points.slice(2, 4).sort((a, b) => a.x - b.x);
                
                let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [top[0].x, top[0].y, top[1].x, top[1].y, bottom[1].x, bottom[1].y, bottom[0].x, bottom[0].y]);
                let dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1200, 0, 1200, 280, 0, 280]);
                
                let dsize = new cv.Size(1200, 280);
                let M_trans = cv.getPerspectiveTransform(srcCoords, dstCoords);
                let warped = new cv.Mat();
                cv.warpPerspective(src, warped, M_trans, dsize);

                // Create Canvas from Warped Mat
                let canvas = document.createElement('canvas');
                cv.imshow(canvas, warped);
                result = canvas;
                warped.delete(); M_trans.delete(); srcCoords.delete(); dstCoords.delete();
            }
            approx.delete();
        }
        low1.delete(); high1.delete(); low2.delete(); high2.delete(); mask1.delete(); mask2.delete(); M.delete(); contours.delete(); hierarchy.delete();
    } catch (e) { console.error('OpenCV processing error:', e); }

    src.delete(); hsv.delete(); mask.delete();
    return result;
}

function applyAdaptiveThreshold(canvas) {
    if (!checkCV()) return;
    let src = cv.imread(canvas);
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 10);
    cv.imshow(canvas, gray);
    src.delete(); gray.delete();
}

// ── Region drawing logic ──
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
 * 95% Accuracy Pipeline:
 * 1. Try OpenCV Perspective Warp (Red Masking)
 * 2. If failing, fallback to Multi-Quadrant Strip Scan
 */
export async function advancedScanImage(imageElement) {
  // ── A. NATIVE DETECTOR (Fastest) ──
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'ean_8'] });
      const hits = await det.detect(imageElement);
      if (hits?.length > 0) return hits[0].rawValue;
    } catch (_) {}
  }

  // ── B. PRO OPENCV WARP (Perspective Correction) ──
  const warpedCanvas = getWarpedLabel(imageElement);
  if (warpedCanvas) {
      // Pass 1: Raw Warped
      let res = await tryScanHtml5(warpedCanvas);
      if (res) return res;

      // Pass 2: Adaptive Binarization (Anti-Glare)
      applyAdaptiveThreshold(warpedCanvas);
      res = await tryScanHtml5(warpedCanvas);
      if (res) return res;
  }

  // ── C. FALLBACK QUADRANT SCAN (Existing logic) ──
  const W = imageElement.naturalWidth || imageElement.width || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const regionDefs = [
    ['top-strip',    0.00, 0.00, 1.00, 0.18],
    ['bottom-strip', 0.00, 0.72, 1.00, 0.28],
    ['full',         0.00, 0.00, 1.00, 1.00],
  ];

  const filters = [
    'none',
    'grayscale(100%) contrast(1.6) brightness(1.1)',
    'grayscale(100%) contrast(2.5) brightness(1.2)',
  ];

  const rotations = [0, 180, 90, 270];
  const scales    = [2.0, 3.0, 1.0];

  for (const filter of filters) {
    ctx.filter = filter;
    for (const scaleFactor of scales) {
      for (const rotation of rotations) {
        for (const [name, xf, yf, wf, hf] of regionDefs) {
          const sx = Math.round(W * xf);
          const sy = Math.round(H * yf);
          const sw = Math.round(W * wf);
          const sh = Math.round(H * hf);
          const finalScale = Math.min(scaleFactor, 2200 / Math.max(sw, sh));
          const dw = Math.round(sw * finalScale);
          const dh = Math.round(sh * finalScale);
          drawRegion(canvas, ctx, imageElement, sx, sy, sw, sh, dw, dh, rotation);
          const res = await tryScanHtml5(canvas);
          if (res) return res;
        }
      }
    }
  }

  return null;
}