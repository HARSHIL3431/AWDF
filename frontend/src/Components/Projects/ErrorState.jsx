/**
 * ErrorState — Friendly error display with icon and retry button.
 */
function ErrorState({ error, onRetry }) {
  const icons = {
    not_found: (
      <svg className="state-card__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4.72 3.22a.75.75 0 011.06 0L8 5.44l2.22-2.22a.75.75 0 111.06 1.06L9.06 6.5l2.22 2.22a.75.75 0 11-1.06 1.06L8 7.56 5.78 9.78a.75.75 0 01-1.06-1.06L6.94 6.5 4.72 4.28a.75.75 0 010-1.06z" />
        <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" />
      </svg>
    ),
    rate_limit: (
      <svg className="state-card__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M5.75.75A.75.75 0 016.5 0h3a.75.75 0 010 1.5h-1v1.27a6.5 6.5 0 01-1 12.94A6.5 6.5 0 016.27 2.77V1.5h-1V.75zm2.173 2.27a5 5 0 102.904 9.213 5 5 0 00-2.904-9.213zM8 5.5a.75.75 0 01.75.75v2.25H10a.75.75 0 010 1.5H7.25V6.25A.75.75 0 018 5.5z" />
      </svg>
    ),
    network: (
      <svg className="state-card__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.254c.46.551.98 1.175.98 2.146v1.296c0 .966.784 1.75 1.75 1.75h.064c.966 0 1.75-.784 1.75-1.75v-1.296c0-.97.52-1.595.98-2.146l.214-.254c.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75zM5.75 12.75v-.5h4.5v.5a.25.25 0 01-.25.25H5.992a.25.25 0 01-.242-.25zM6 14.5h4v.25a.25.25 0 01-.25.25h-3.5a.25.25 0 01-.25-.25V14.5z" />
      </svg>
    ),
    invalid: (
      <svg className="state-card__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575zM8 5a.75.75 0 00-.75.75v2.5a.75.75 0 001.5 0v-2.5A.75.75 0 008 5zm1 6a1 1 0 10-2 0 1 1 0 002 0z" />
      </svg>
    ),
  };

  return (
    <div className="state-card" role="alert">
      {icons[error.type] || icons.network}
      <h3 className="state-card__heading">Something went wrong</h3>
      <p className="state-card__desc">{error.message}</p>
      <button className="btn btn--primary" onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}

export default ErrorState;
