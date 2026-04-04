import { useRef, useState } from 'react';

// Client-Side Canvas Compression
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_WIDTH = 1280;
        
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Compress as JPEG 0.7
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve({
          id: Math.random().toString(36).substring(2, 11),
          file_name: file.name,
          dataUrl: dataUrl,
          status: 'pending', // pending, scanning, process_backend, done, error
          barcode: null,
          resultData: null
        });
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

export default function ImageUpload({ onImagesQueued }) {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setLoading(true);
      const files = Array.from(e.target.files);
      const processedFiles = [];
      
      for (const file of files) {
          processedFiles.push(await compressImage(file));
      }
      
      setLoading(false);
      if (onImagesQueued) onImagesQueued(processedFiles);
      
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="image-upload">
      <label className="upload-area" htmlFor="barcode-image">
        {loading ? (
          <div className="upload-placeholder">
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <p>Compressing Images...</p>
            <span className="upload-hint">Performing local canvas compression</span>
          </div>
        ) : (
          <div className="upload-placeholder">
            <span className="upload-icon">📷</span>
            <p>Upload Photos</p>
            <span className="upload-hint">Select multiple images from gallery</span>
          </div>
        )}
        <input
          ref={fileRef}
          id="barcode-image"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="file-input"
          disabled={loading}
        />
      </label>
    </div>
  );
}
