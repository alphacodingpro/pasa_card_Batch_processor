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
  BarcodeFormat.DATA_MATRIX,
]);
hints.set(DecodeHintType.TRY_HARDER, true);

const reader = new BrowserMultiFormatReader(hints);

// ── HTML5-QRCode Configuration ──
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
  let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  while(n--){
      u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, {type:mime});
}

// ── Utils ──
async function tryScanZxing(canvas) {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const result = await reader.decodeFromImageUrl(dataUrl);
    if (result && result.getText()) return result.getText();
  } catch (_) {}
  return null;
}

/**
 * Scan an <img> element using overlapping grids (sliding window)
 * to catch tiny barcodes in high-res images.
 */
export async function advancedScanImage(imageElement) {
  // ── 1. Native API (Fastest) ──
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

  const W = imageElement.naturalWidth || imageElement.width;
  const H = imageElement.naturalHeight || imageElement.height;
  if (!W || !H) return null;

  // ── 2. Determine Regions ──
  const isCroppedStrip = (W / H > 2.5) || (H / W > 2.5);
  const regions = [];
  regions.push({ name: 'Full Image', x: 0, y: 0, w: 1, h: 1 });

  if (!isCroppedStrip) {
    // High probability regions (Standard upright PSA)
    regions.push({ name: 'PSA Top Strip 15%', x: 0, y: 0, w: 1, h: 0.15 });
    regions.push({ name: 'PSA Top Strip 25%', x: 0, y: 0, w: 1, h: 0.25 });
    
    // Upside-down PSA cards
    regions.push({ name: 'PSA Bottom Strip 15%', x: 0, y: 0.85, w: 1, h: 0.15 });
    regions.push({ name: 'PSA Bottom Strip 25%', x: 0, y: 0.75, w: 1, h: 0.25 });
    
    // Half splits to catch sideways photos
    regions.push({ name: 'Top Half', x: 0, y: 0, w: 1, h: 0.5 });
    regions.push({ name: 'Left Half', x: 0, y: 0, w: 0.5, h: 1 });
    regions.push({ name: 'Right Half', x: 0.5, y: 0, w: 0.5, h: 1 });
    regions.push({ name: 'Bottom Half', x: 0, y: 0.5, w: 1, h: 0.5 });
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // ── 3. Execute Zxing Regions ──
  // ZXing works best when image boundaries are max ~1200
  for (const region of regions) {
    const rx = W * region.x;
    const ry = H * region.y;
    const rw = W * region.w;
    const rh = H * region.h;

    const scale = Math.min(1, 1200 / Math.max(rw, rh));
    const sw = Math.round(rw * scale);
    const sh = Math.round(rh * scale);

    const filters = [
      'none',
      isCroppedStrip ? 'none' : 'grayscale(100%) contrast(1.5) brightness(1.1)',
    ];

    const rotations = [
       { name: '0°', angle: 0, w: sw, h: sh },
       { name: '90°', angle: Math.PI / 2, w: sh, h: sw },
       { name: '180°', angle: Math.PI, w: sw, h: sh },
       { name: '270°', angle: -Math.PI / 2, w: sh, h: sw }
    ];

    for (const filter of filters) {
       for (const rot of rotations) {
          canvas.width = rot.w;
          canvas.height = rot.h;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          
          if (rot.angle !== 0) {
             ctx.translate(rot.w / 2, rot.h / 2);
             ctx.rotate(rot.angle);
             ctx.filter = filter;
             ctx.drawImage(imageElement, rx, ry, rw, rh, -sw/2, -sh/2, sw, sh);
          } else {
             ctx.filter = filter;
             ctx.drawImage(imageElement, rx, ry, rw, rh, 0, 0, sw, sh);
          }
          
          let res = await tryScanZxing(canvas);
          if (res) { 
             console.log(`[Scanner ZX] Found in ${region.name} (${rot.name}):`, filter); 
             return res; 
          }
       }
    }
  }

  // ── 4. Final Fallback: HTML5-QRCode on Full Image ──
  console.log('[Scanner] Falling back to robust HTML5-QRCode scanner');
  try {
    canvas.width = W; 
    canvas.height = H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.drawImage(imageElement, 0, 0, W, H);
    
    // Scale for html5-qrcode
    const scale5 = Math.min(1, 1000 / Math.max(W, H));
    const cvs2 = document.createElement('canvas');
    cvs2.width = W * scale5;
    cvs2.height = H * scale5;
    const ctx2 = cvs2.getContext('2d');
    ctx2.drawImage(canvas, 0, 0, cvs2.width, cvs2.height);

    const fileUrl = cvs2.toDataURL('image/jpeg', 0.9);
    const file = dataURLtoFile(fileUrl, 'final_fallback.jpg');
    const result = await getScanner().scanFile(file, true);
    if (result) {
      console.log('[Scanner] Found with HTML5-QRCode:', result);
      return result;
    }
  } catch (err) {}

  console.log('[Scanner] All advanced scanning paths failed');
  return null;
}
