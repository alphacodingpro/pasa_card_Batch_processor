// ── Pro Pre-processing (OpenCV) ──
function getWarpedLabel(imageElement) {
    if (!checkCV()) return null;

    let src = cv.imread(imageElement);
    let hsv = new cv.Mat();
    let mask = new cv.Mat();
    let result = null;

    try {
        // Red detection optimized for PSA labels (Captures faint and deep reds)
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // Lower and Upper red ranges
        let low1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 100, 40, 0]);
        let high1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [15, 255, 255, 0]);
        let low2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [155, 100, 40, 0]);
        let high2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 0]);

        let mask1 = new cv.Mat();
        let mask2 = new cv.Mat();
        cv.inRange(hsv, low1, high1, mask1);
        cv.inRange(hsv, low2, high2, mask2);
        cv.add(mask1, mask2, mask);

        // Morphological operations to group red chunks
        let M = cv.Mat.ones(7, 7, cv.CV_8U);
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, M);
        
        // Find Label Contour
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestIdx = -1;
        for (let i = 0; i < contours.size(); ++i) {
            let area = cv.contourArea(contours.get(i));
            if (area > maxArea) { maxArea = area; bestIdx = i; }
        }

        // Must be at least 1% of the image to be the label
        if (bestIdx !== -1 && maxArea > (src.rows * src.cols * 0.005)) {
            let cnt = contours.get(bestIdx);
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            if (approx.rows === 4) {
                // Perspective Warp to fix tilt/angle
                let pts = [];
                for (let i = 0; i < 4; i++) pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
                
                pts.sort((a, b) => a.y - b.y);
                let t = pts.slice(0, 2).sort((a, b) => a.x - b.x);
                let b = pts.slice(2, 4).sort((a, b) => a.x - b.x);
                
                let srcP = cv.matFromArray(4, 1, cv.CV_32FC2, [t[0].x, t[0].y, t[1].x, t[1].y, b[1].x, b[1].y, b[0].x, b[0].y]);
                let dstP = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1200, 280, 1200, 280, 0, 280]); // Final resolution
                dstP.data32F[2] = 1200; dstP.data32F[3] = 0; // Fix coords
                
                let trans = cv.getPerspectiveTransform(srcP, dstP);
                let warped = new cv.Mat();
                cv.warpPerspective(src, warped, trans, new cv.Size(1200, 280));

                let canvas = document.createElement('canvas');
                cv.imshow(canvas, warped);
                result = canvas;
                warped.delete(); trans.delete(); srcP.delete(); dstP.delete();
            }
            approx.delete();
        }
        low1.delete(); high1.delete(); low2.delete(); high2.delete(); mask1.delete(); mask2.delete(); M.delete(); contours.delete(); hierarchy.delete();
    } catch (e) { console.error('Warp Error:', e); }

    src.delete(); hsv.delete(); mask.delete();
    return result;
}

function applySharpen(canvas) {
    if (!checkCV()) return;
    let src = cv.imread(canvas);
    let dst = new cv.Mat();
    // Strong sharpening kernel to make barcode lines pop
    let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
    cv.filter2D(src, dst, -1, kernel);
    cv.imshow(canvas, dst);
    src.delete(); dst.delete(); kernel.delete();
}

function applyAdaptiveThreshold(canvas) {
    if (!checkCV()) return;
    let src = cv.imread(canvas);
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 12);
    cv.imshow(canvas, gray);
    src.delete(); gray.delete();
}

// ── Main Scan Pipeline ──
export async function advancedScanImage(imageElement) {
  // Pass 0: Hardware (Ultra-Fast)
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'upc_a'] });
      const hits = await det.detect(imageElement);
      if (hits?.length > 0) return hits[0].rawValue;
    } catch (_) {}
  }

  // Pass 1: Pro OpenCV Perspective Warp (High Accuracy)
  const warped = getWarpedLabel(imageElement);
  if (warped) {
      // 1. Raw warp
      let res = await tryScanHtml5(warped);
      if (res) return res;

      // 2. Warped + Sharpened
      applySharpen(warped);
      res = await tryScanHtml5(warped);
      if (res) return res;

      // 3. Warped + Adaptive Binarization
      applyAdaptiveThreshold(warped);
      res = await tryScanHtml5(warped);
      if (res) return res;
  }

  // Pass 2: High-Zoom Fast Pass (Speed Optimization)
  // PSA labels are almost always at the TOP or BOTTOM. 3x zoom is needed for tiny bars.
  const W = imageElement.naturalWidth || imageElement.width || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  const fastRegions = [
    { name: 'top-zoom',    sx: 0, sy: 0,        sw: W, sh: H * 0.20 },
    { name: 'bottom-zoom', sx: 0, sy: H * 0.70, sw: W, sh: H * 0.30 }
  ];

  for (const reg of fastRegions) {
    // Zoom 3.0x is critical for Code 128 resolution
    const dw = reg.sw * 3.0;
    const dh = reg.sh * 3.0;
    
    // Normal + 180 degrees only for speed
    for (const rot of [0, 180]) {
      drawRegion(canvas, ctx, imageElement, reg.sx, reg.sy, reg.sw, reg.sh, dw, dh, rot);
      const res = await tryScanHtml5(canvas);
      if (res) return res;
    }
  }

  // Pass 3: Brute Force Fallback (Slow - 3 Filters, 4 Rotations, 2 Scales)
  const regionDefs = [['top-strip', 0, 0, 1, 0.20], ['bottom-strip', 0, 0.70, 1, 0.30], ['full', 0, 0, 1, 1]];
  const filters = ['grayscale(100%) contrast(1.6)', 'none', 'grayscale(200%) contrast(2.5)'];
  const rotations = [0, 180, 90, 270];
  const scales = [2.0, 1.0];

  for (const filter of filters) {
    ctx.filter = filter;
    for (const scale of scales) {
      for (const rot of rotations) {
        for (const [name, xf, yf, wf, hf] of regionDefs) {
          const finalScale = Math.min(scale, 2200 / Math.max(W*wf, H*hf));
          drawRegion(canvas, ctx, imageElement, W*xf, H*yf, W*wf, H*hf, W*wf*finalScale, H*hf*finalScale, rot);
          const res = await tryScanHtml5(canvas);
          if (res) return res;
        }
      }
    }
  }
  return null;
}