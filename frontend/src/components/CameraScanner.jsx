import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function CameraScanner({ onScan, active }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) {
      // Stop camera when not active
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
      return;
    }

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    const startScanning = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access requires HTTPS or localhost. If on mobile, please use the Upload Image fallback or setup HTTPS.');
        }

        const controls = await reader.decodeFromVideoDevice(
          undefined, // use default camera
          videoRef.current,
          (result, err) => {
            if (result) {
              const text = result.getText();
              if (text) {
                onScan(text);
              }
            }
            // Ignore NotFoundException — it just means no barcode in current frame
          }
        );
        controlsRef.current = controls;
      } catch (e) {
        console.error('Camera error:', e);
        if (e.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera permissions.');
        } else if (e.name === 'NotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError(`Camera error: ${e.message}`);
        }
      }
    };

    startScanning();

    return () => {
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
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
            <video ref={videoRef} className="scanner-video" />
            <div className="scan-overlay">
              <div className="scan-frame">
                <div className="corner tl" />
                <div className="corner tr" />
                <div className="corner bl" />
                <div className="corner br" />
                <div className="scan-line" />
              </div>
            </div>
          </div>
          <p className="scanner-hint">Point camera at a barcode</p>
        </>
      )}
    </div>
  );
}
