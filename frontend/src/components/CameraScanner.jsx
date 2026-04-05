import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

export default function CameraScanner({ onScan, active }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (capabilities.torch) {
        const newState = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: newState }] });
        setTorchOn(newState);
      } else {
        console.log('Flashlight not supported on this device.');
      }
    } catch (err) {
      console.log('Flashlight error:', err);
    }
  };

  useEffect(() => {
    if (!active) {
      if (readerRef.current) {
        readerRef.current.reset();
        readerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      return;
    }

    const startCamera = async () => {
      try {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.UPC_A
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        
        const codeReader = new BrowserMultiFormatReader(hints);
        readerRef.current = codeReader;

        // Start video stream focusing on environment camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Try applying initial zoom natively if available
        setTimeout(async () => {
          try {
             const track = stream.getVideoTracks()[0];
             const caps = track.getCapabilities ? track.getCapabilities() : {};
             if (caps.zoom) {
                // Try 2x zoom or max supported
                const targetZoom = Math.min(2.0, caps.zoom.max || 2.0);
                await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
             }
          } catch(e) { console.log('Zoom not supported'); }
        }, 500);

        // Decode from video continuously
        codeReader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
          if (result && result.getText()) {
            codeReader.reset();
            onScan(result.getText());
          }
        }).catch(err => {
          console.error("Reader error", err);
        });

      } catch (err) {
        console.error('Camera init error:', err);
        setError(`Camera error: ${err.message || err}`);
      }
    };

    startCamera();

    return () => {
      if (readerRef.current) readerRef.current.reset();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
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
          <div className="video-container" style={{ position: 'relative', overflow: 'hidden', borderRadius: '8px' }}>
            <video 
              ref={videoRef} 
              id="camera-video" 
              style={{ width: '100%', minHeight: '300px', backgroundColor: '#000', objectFit: 'cover' }} 
            />
            
            {/* Viewfinder overlay */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              <div style={{
                width: '80%', height: '40%', border: '2px dashed rgba(74, 222, 128, 0.8)',
                boxShadow: '0 0 0 1000px rgba(0,0,0,0.5)', borderRadius: '8px'
              }} />
            </div>

            <button 
              onClick={toggleTorch} 
              className="torch-btn" 
              title="Toggle Flashlight"
              style={{
                position: 'absolute',
                bottom: '20px',
                right: '20px',
                zIndex: 10,
                background: 'rgba(0,0,0,0.6)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              {torchOn ? '🔦 Flash ON' : '💡 Flash OFF'}
            </button>
          </div>
          <p className="scanner-hint" style={{ marginTop: '12px', textAlign: 'center', color: '#ccc', fontSize: '0.85rem' }}>
            📌 Center the barcode inside the green box.
          </p>
        </>
      )}
    </div>
  );
}
