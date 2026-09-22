import { useState } from 'react';
import { authService } from '../services/authService';
import { NavLink } from 'react-router-dom';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setSubmitting(true);
    try {
      await authService.forgotPassword(email);
      setMessage('If an account exists for this email, a password reset link has been sent.');
      setEmail('');
    } catch (err) {
      setError(err.message || 'Failed to send reset link');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-card">
      <div>
        <p className="eyebrow">Recover Access</p>
        <h2>Forgot Password</h2>
        <p className="muted auth-switch">
          Enter your registered email address and we'll send you a password reset link.
        </p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="toast toast-success" style={{ position: 'static', margin: '0 0 16px', animation: 'none' }}>{message}</div>}

      <form className="contact-form" onSubmit={handleSubmit}>
        <label htmlFor="forgot-email">
          Email
          <input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="enter your email"
            required
            disabled={submitting}
            autoComplete="email"
          />
        </label>

        <div className="action-row" style={{ marginTop: '8px' }}>
          <button type="submit" className="form-button" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send Reset Link'}
          </button>
        </div>
      </form>

      <p className="muted auth-switch" style={{ marginTop: '16px', textAlign: 'center' }}>
        <NavLink to="/tasks" style={{ color: 'inherit' }}>← Back to Login</NavLink>
      </p>
    </section>
  );
}

export default ForgotPassword;