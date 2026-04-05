import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function CameraScanner({ onScan, active }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);

  // Toggle Flashlight/Torch using Html5Qrcode constraints
  const toggleTorch = async () => {
    if (!scannerRef.current) return;
    try {
      const newState = !torchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: newState }]
      });
      setTorchOn(newState);
    } catch (err) {
      console.log('Flashlight not supported:', err);
    }
  };

  useEffect(() => {
    if (!active) {
      if (scannerRef.current) {
        scannerRef.current.stop()
          .then(() => { scannerRef.current = null; })
          .catch(err => console.error('Error stopping scanner:', err));
      }
      return;
    }

    // Initialize HTML5-QRCode
    let scanner = new Html5Qrcode('camera-reader-el');
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        const config = {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
             // Optimize box for 1D barcodes (wide and short)
             return { width: viewfinderWidth * 0.8, height: viewfinderHeight * 0.4 };
          },
          aspectRatio: 1.777778, // 16:9
          videoConstraints: {
            facingMode: 'environment', // Rear camera
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        };

        await scanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            // Success handler
            if (scannerRef.current) {
               scanner.stop().then(() => {
                 scannerRef.current = null;
                 onScan(decodedText);
               }).catch(e => {
                 onScan(decodedText); // Still call onScan even if stop fails
               });
            }
          },
          () => {
            // Frame-level failure (silent)
          }
        );

        // Attempt initial zoom for PSA barcodes
        setTimeout(async () => {
           try {
              // Note: html5-qrcode doesn't have a direct "setZoom" but we can try constraints
              // Most mobile browsers now support this via applyVideoConstraints
              await scanner.applyVideoConstraints({
                 advanced: [{ zoom: 2.0 }] 
              });
           } catch(e) { console.log('Initial zoom failed'); }
        }, 1000);

      } catch (err) {
        console.error('Scanner start error:', err);
        setError(`Camera error: ${err.message || err}`);
      }
    };

    startScanner();

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop()
          .then(() => { scannerRef.current = null; })
          .catch(e => console.log('Cleanup stop failed', e));
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
          <div className="video-container" style={{ position: 'relative' }}>
             {/* id="camera-reader-el" is where HTML5Qrcode renders */}
            <div id="camera-reader-el" style={{ width: '100%', minHeight: '300px', backgroundColor: '#000' }} />
            
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
                fontSize: '0.8rem'
              }}
            >
              {torchOn ? '🔦 Flash ON' : '💡 Flash OFF'}
            </button>
          </div>
          <p className="scanner-hint" style={{ marginTop: '12px', textAlign: 'center', color: '#ccc', fontSize: '0.85rem' }}>
            📌 Point the camera at the barcode on the top of the PSA slab.
          </p>
        </>
      )}
    </div>
  );
}

