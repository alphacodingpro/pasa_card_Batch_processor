import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/browser';

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

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', true);
          await videoRef.current.play();
        }

        const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (result) {
            const text = result.getText();
            if (text) onScan(text);
          }
        });

        controlsRef.current = controls;
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
