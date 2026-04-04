import { Html5Qrcode } from 'html5-qrcode';

let html5QrCode = null;

function getScanner() {
  if (html5QrCode) return html5QrCode;
  let scannerContainer = document.getElementById('dummy-html5-scanner');
  if (!scannerContainer) {
    scannerContainer = document.createElement('div');
    scannerContainer.id = 'dummy-html5-scanner';
    scannerContainer.style.display = 'none';
    document.body.appendChild(scannerContainer);
  }
  html5QrCode = new Html5Qrcode("dummy-html5-scanner");
  return html5QrCode;
}

function dataURLtoFile(dataurl, filename) {
  let arr = dataurl.split(','),
      mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), 
      n = bstr.length, 
      u8arr = new Uint8Array(n);
      
  while(n--){
      u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, {type:mime});
}

async function tryScan(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const file = dataURLtoFile(dataUrl, 'temp_scan.jpg');
    const scanner = getScanner();
    const result = await scanner.scanFile(file, true); // true = scan 1D barcodes as well
    if (result) return result;
  } catch (_) {
    // Not found
  }
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
        formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13', 'upc_a', 'ean_8', 'upc_e'],
      });
      const hits = await detector.detect(imageElement);
      if (hits && hits.length > 0) {
        console.log('[Scanner] Native hit:', hits[0].rawValue);
        return hits[0].rawValue;
      }
    } catch (_) {}
  }

  // ── HTML5-QRCode fallback ──
  const W = imageElement.naturalWidth  || imageElement.width  || 0;
  const H = imageElement.naturalHeight || imageElement.height || 0;
  if (!W || !H) return null;

  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d', { willReadFrequently: true });

  const scale = Math.min(1, 1500 / Math.max(W, H));
  const sw = Math.round(W * scale);
  const sh = Math.round(H * scale);

  const filters = [
    'none',
    'grayscale(100%) contrast(1.5)',
    'grayscale(100%) contrast(2.5) brightness(1.2)',
  ];

  for (const filter of filters) {
    // Normal pass
    canvas.width  = sw;
    canvas.height = sh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = filter;
    ctx.drawImage(imageElement, 0, 0, sw, sh);
    let res = await tryScan(canvas);
    if (res) { console.log('[Scanner] HTML5-QC Normal:', filter); return res; }

    // 90° Rotated pass
    canvas.width  = sh;
    canvas.height = sw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(sh / 2, sw / 2);
    ctx.rotate(Math.PI / 2);
    ctx.filter = filter;
    ctx.drawImage(imageElement, -sw / 2, -sh / 2, sw, sh);
    res = await tryScan(canvas);
    if (res) { console.log('[Scanner] HTML5-QC Rotated 90°:', filter); return res; }
  }

  console.log('[Scanner] All passes failed');
  return null;
}
