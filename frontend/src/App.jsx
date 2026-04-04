import { useState } from 'react';
import CameraScanner from './components/CameraScanner';
import ImageUpload from './components/ImageUpload';
import BatchProcessor from './components/BatchProcessor';
import './App.css';

function App() {
  const [mode, setMode] = useState(null); // 'camera', 'upload', 'batch'
  const [queue, setQueue] = useState([]);

  const handleImagesQueued = (processedFiles) => {
    setQueue(prev => [...prev, ...processedFiles]);
    setMode('batch');
  };

  const handleCameraScan = (barcode) => {
    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
      file: null,
      dataUrl: null, // No image preview for live camera scans
      file_name: `Camera Scan (${barcode})`,
      status: 'camera_scanned', 
      barcode: barcode,
      data: null,
      error: null
    };
    setQueue(prev => [...prev, newItem]);
    setMode('batch'); // Close camera and show processing mode immediately
  };

  const reset = () => {
    setMode(null);
    setQueue([]);
  };

  return (
    <div className="app">
      {/* Animated Background */}
      <div className="blobs">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-glow" />
        <h1 className="app-title">Scan It </h1>
        <p className="app-subtitle">PSA Card Batch Processor</p>
      </header>

      <main className="app-main">
        {mode === null && (
          <div className="intro-card" style={{background: 'var(--bg-card)', padding: '24px', borderRadius: '16px', border: '1px solid var(--glass-border)', textAlign: 'center'}}>
            <h2 style={{color: '#fff', fontSize: '1.4rem', marginBottom: '8px'}}>Start Processing</h2>
            <p style={{color: 'var(--text-secondary)'}}>Upload 10+ PSA card images from your gallery to scan and scrape pricing data automatically.</p>
          </div>
        )}

        {(mode === 'upload') && (
          <ImageUpload onImagesQueued={handleImagesQueued} />
        )}

        {queue.length > 0 && (
          <BatchProcessor queue={queue} setQueue={setQueue} />
        )}

        {mode === 'camera' && queue.length === 0 && (
          <CameraScanner onScan={handleCameraScan} active={true} />
        )}
      </main>

      {/* Floating Action Bar */}
      {queue.length === 0 && (
        <div className="floating-actions">
          {mode === null ? (
            <>
              <button className="modern-btn secondary-btn" onClick={() => setMode('upload')} title="Upload Images">
                <span className="btn-icon">📁</span>
              </button>
              <button className="modern-btn primary-btn" onClick={() => setMode('camera')}>
                <span className="btn-icon">📸</span>
                Live Camera
              </button>
            </>
          ) : (
            <button className="modern-btn return-btn" onClick={() => setMode(null)}>
              <span className="btn-icon">❌</span>
              Cancel
            </button>
          )}
        </div>
      )}
      
      {queue.length > 0 && (
          <div className="floating-actions">
             <button className="modern-btn secondary-btn" onClick={() => setMode('upload')} title="Add more images" style={{background: 'var(--accent-3)'}}>
                <span className="btn-icon">➕</span>
             </button>
             <button className="modern-btn return-btn" onClick={reset}>
              <span className="btn-icon">🗑️</span> Clear Queue
            </button>
          </div>
      )}
    </div>
  );
}

export default App;
