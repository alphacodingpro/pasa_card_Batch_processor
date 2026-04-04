import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export default function CameraScanner({ onScan, active }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);

  const toggleTorch = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities()?.torch) return;
    const newState = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: newState }] });
    setTorchOn(newState);
  };

  useEffect(() => {
    if (!active) {
      if (controlsRef.current) { controlsRef.current.stop(); controlsRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      return;
    }

    // Hints: focus on Code128 (PSA barcode type) for faster, more accurate scanning
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.UPC_A,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    const startScanning = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires HTTPS. Please use Upload Image instead.');
        }

        // Request high-res rear camera — critical for small barcodes on PSA slabs
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }, // rear camera
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          }
        });
        streamRef.current = stream;

        // Attempt to auto-zoom (2.5x) for tiny PSA barcodes
        try {
          const track = stream.getVideoTracks()[0];
          const capabilities = track.getCapabilities();
          if (capabilities.zoom) {
            const zoomVal = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, 2.5));
            await track.applyConstraints({ advanced: [{ zoom: zoomVal }] });
          }
        } catch (err) {
          console.log('Zoom not supported or failed');
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', true);
          await videoRef.current.play();
        }

        // Custom manual polling loop for robust 1D barcode detection
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let scanning = true;

        controlsRef.current = {
            stop: () => { scanning = false; }
        };

        const scanFrame = async () => {
          if (!scanning || !videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
             if (scanning) requestAnimationFrame(scanFrame);
             return;
          }

          try {
             // Native Hardware Acceleration - INSTANT detection on supported devices (Chrome Android, iOS 17 Safari)
             if ('BarcodeDetector' in window) {
                 try {
                     const detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'upc_a'] });
                     const barcodes = await detector.detect(videoRef.current);
                     if (barcodes && barcodes.length > 0) {
                         const text = barcodes[0].rawValue;
                         if (text) {
                             scanning = false;
                             onScan(text);
                             return;
                         }
                     }
                 } catch(e) {} // Fallback to JS ZXing if native fails or camera is busy
             }

             // ZXing JS Fallback needs a smaller, optimized frame
             const vw = videoRef.current.videoWidth;
             const vh = videoRef.current.videoHeight;
             
             // Base scale
             const scale = Math.min(800 / vw, 800 / vh) || 1;
             const cw = vw * scale;
             const ch = vh * scale;
             
             canvas.width = cw;
             canvas.height = ch;
             
             // Pass 1: Normal Orientation (with contrast boost)
             ctx.filter = 'grayscale(100%) contrast(1.5) brightness(1.1)';
             ctx.drawImage(videoRef.current, 0, 0, cw, ch);
             
             let result = null;
             try { result = await reader.decodeFromCanvas(canvas); } catch(e) {}
             
             // Pass 2: Rotated 90 Degrees (Critical for portrait-mode scanning of horizontal barcodes!)
             if (!result) {
                 canvas.width = ch;
                 canvas.height = cw;
                 ctx.setTransform(1, 0, 0, 1, 0, 0);
                 ctx.translate(canvas.width / 2, canvas.height / 2);
                 ctx.rotate(90 * Math.PI / 180);
                 ctx.filter = 'grayscale(100%) contrast(1.5) brightness(1.1)';
                 ctx.drawImage(videoRef.current, -cw / 2, -ch / 2, cw, ch);
                 
                 try { result = await reader.decodeFromCanvas(canvas); } catch(e) {}
             }

             if (result && result.getText()) {
                 const text = result.getText();
                 scanning = false; // Stop immediately
                 onScan(text);
                 return;
             }
          } catch(err) {
             // Ignore frame errors
          }

          // Polling rate ~ 3 FPS to avoid freezing mobile UI
          setTimeout(() => {
              if (scanning) requestAnimationFrame(scanFrame);
          }, 300);
        };

        requestAnimationFrame(scanFrame);

      } catch (e) {
        console.error('Camera error:', e);
        if (e.name === 'NotAllowedError') setError('Camera access denied. Please allow camera permissions.');
        else if (e.name === 'NotFoundError') setError('No camera found on this device.');
        else setError(`Camera error: ${e.message}`);
      }
    };

    startScanning();

    return () => {
      if (controlsRef.current) { controlsRef.current.stop(); controlsRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
  }, [active, onScan]);

  if (!active) return null;

  return (
    <div className="camera-scanner">
      {error ? (
        <div className="scanner-error">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      ) : (
        <>
          <div className="video-container">
            <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />
            <div className="scan-overlay">
              <div className="scan-frame">
                <div className="corner tl" />
                <div className="corner tr" />
                <div className="corner bl" />
                <div className="corner br" />
                <div className="scan-line" />
              </div>
            </div>
            <button onClick={toggleTorch} className="torch-btn" title="Toggle Flashlight">
              {torchOn ? '🔦 Flash ON' : '💡 Flash OFF'}
            </button>
          </div>
          <p className="scanner-hint">
            📌 PSA slab ke upar wale barcode par camera rakhein. Chhota barcode ho tou Flash button istamal karein.
          </p>
        </>
      )}
    </div>
  );
}
