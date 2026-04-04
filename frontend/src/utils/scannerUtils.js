import { BrowserMultiFormatReader } from '@zxing/browser';

const reader = new BrowserMultiFormatReader();

/**
 * Advanced scanner that uses a dense overlapping grid (Full, Halves, Quarters, Ninths)
 * and tests both Horizontal (0 deg) and Vertical (90 deg) orientations for each chunk.
 * Return string barcode value or null.
 */
export async function advancedScanImage(imageElement) {
  const regions = [];
  
  // 1. Full Image
  regions.push({ name: 'Full Image', x: 0, y: 0, w: 1, h: 1 });

  // 2. PSA Top Strip — barcode is ALWAYS at the top of PSA slabs
  regions.push({ name: 'PSA Top Strip', x: 0, y: 0, w: 1, h: 0.2 });
  regions.push({ name: 'PSA Top Strip Wide', x: 0, y: 0, w: 1, h: 0.35 });

  // 3. Overlapping Halves
  regions.push({ name: 'Top', x: 0, y: 0, w: 1, h: 0.6 });
  regions.push({ name: 'Bottom', x: 0, y: 0.4, w: 1, h: 0.6 });
  regions.push({ name: 'Left', x: 0, y: 0, w: 0.6, h: 1 });
  regions.push({ name: 'Right', x: 0.4, y: 0, w: 0.6, h: 1 });
  
  // 4. 2x2 Grid (Overlapping Quarters)
  for (let x of [0, 0.4]) {
    for (let y of [0, 0.4]) {
        regions.push({ name: `Quarter ${x}-${y}`, x, y, w: 0.6, h: 0.6 });
    }
  }

  // 5. 3x3 Grid (Overlapping Ninths)
  for (let x of [0, 0.3, 0.6]) {
    for (let y of [0, 0.3, 0.6]) {
        regions.push({ name: `Ninth ${x}-${y}`, x, y, w: 0.4, h: 0.4 });
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tryScanCanvas = async (cvs) => {
      // low quality jpeg is faster for ZXing
      const dataUrl = cvs.toDataURL('image/jpeg', 0.8);
      try {
          const result = await reader.decodeFromImageUrl(dataUrl);
          if (result && result.getText()) return result.getText();
      } catch (e) {
          // Internal ZXing ignore
      }
      return null;
  };

  for (const region of regions) {
    const rx = imageElement.naturalWidth * region.x;
    const ry = imageElement.naturalHeight * region.y;
    const rw = imageElement.naturalWidth * region.w;
    const rh = imageElement.naturalHeight * region.h;

    // ZXing works best with 800-1200px range for small barcodes
    const MAX_DIM = 1200;
    let scale = 1;
    if (rw > MAX_DIM || rh > MAX_DIM) {
      scale = Math.min(MAX_DIM / rw, MAX_DIM / rh);
    }

    const sw = rw * scale;
    const sh = rh * scale;

    // === Pass 1: Original Orientation ===
    canvas.width = sw;
    canvas.height = sh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Convert to grayscale and boost contrast to help weak barcodes
    ctx.filter = 'grayscale(100%) contrast(1.5) brightness(1.1) sharpen(1)';
    ctx.drawImage(imageElement, rx, ry, rw, rh, 0, 0, sw, sh);
    
    let res = await tryScanCanvas(canvas);
    if (res) {
        console.log(`[Scanner] Found in ${region.name} (Horizontal)`);
        return res;
    }

    // === Pass 2: Rotated 90 Degrees ===
    // Critical for vertical barcodes moving to horizontal!
    canvas.width = sh;
    canvas.height = sw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((90 * Math.PI) / 180);
    ctx.filter = 'grayscale(100%) contrast(1.15) brightness(1.05)';
    ctx.drawImage(imageElement, rx, ry, rw, rh, -sw / 2, -sh / 2, sw, sh);

    res = await tryScanCanvas(canvas);
    if (res) {
        console.log(`[Scanner] Found in ${region.name} (Vertical)`);
        return res;
    }
  }

  console.log(`[Scanner] Intensive sliding-window scan failed.`);
  return null;
}
