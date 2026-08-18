import { Link } from 'react-router-dom';

function NotFound() {
  return (
    <section className="not-found-card">
      <span className="not-found-code">404</span>
      <h2>Page not found</h2>
      <p className="muted">
        The route you requested does not exist. Use the navigation to return to
        a valid page.
      </p>
      <div className="action-row" style={{ justifyContent: 'center' }}>
        <Link className="cta-link" to="/">
          Return Home
        </Link>
      </div>
    </section>
  );
}

export default NotFound;