export default function ResultDisplay({ result, loading, error }) {
  if (loading) {
    return (
      <div className="result-card loading-card">
        <div className="loader">
          <div className="spinner" />
          <p className="loading-text">Searching product...</p>
          <span className="loading-sub">Querying product databases</span>
        </div>
      </div>
    );
  }

  if (error === 'MISSING_API_KEY') {
    return (
      <div className="result-card api-key-card">
        <div className="error-content">
          <span className="error-emoji">🔑</span>
          <h3>API Key Required</h3>
          <p>You need a valid SerpAPI key to search for products.</p>
          <div className="api-instructions">
            <ol>
              <li>Get a free key from <strong>serpapi.com</strong></li>
              <li>Open <code>backend/.env</code> in your code</li>
              <li>Add: <code>SERPAPI_KEY=your_key</code></li>
              <li>The backend will auto-reload!</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="result-card error-card">
        <div className="error-content">
          <span className="error-emoji">😕</span>
          <h3>Something went wrong</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="result-card success-card">
      <div className="result-header">
        <span className="result-badge">✅ Product Found</span>
      </div>
      <div className="result-body">
        <h2 className="product-title">{result.title}</h2>
        <div className="product-details">
          <div className="detail-row">
            <span className="detail-label">Price</span>
            <span className="detail-value price-value">{result.price}</span>
          </div>
          {result.source && (
            <div className="detail-row">
              <span className="detail-label">Source</span>
              <a
                href={result.source}
                target="_blank"
                rel="noopener noreferrer"
                className="source-link"
              >
                View Product ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
