import { useState } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { authService } from '../services/authService';

function ResetPassword() {
  const { token } = useParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isTokenValid = token && token.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!isTokenValid) {
      setError('Invalid reset link');
      return;
    }

    if (!password.trim() || !confirmPassword.trim()) {
      setError('Please fill in both fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      await authService.resetPassword(token, password);
      setMessage('Password reset successfully.');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isTokenValid) {
    return (
      <section className="auth-card">
        <div>
          <p className="eyebrow">Error</p>
          <h2>Invalid Reset Link</h2>
          <p className="muted auth-switch">
            This password reset link is invalid or has expired.
          </p>
        </div>
        <div className="error-message">{error || 'Invalid or expired reset token'}</div>
        <p className="muted auth-switch" style={{ marginTop: '16px', textAlign: 'center' }}>
          <NavLink to="/forgot-password" style={{ color: 'inherit' }}>Request a new reset link</NavLink>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <div>
        <p className="eyebrow">Set New Password</p>
        <h2>Reset Password</h2>
        <p className="muted auth-switch">
          Enter your new password below. Must be at least 6 characters.
        </p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="toast toast-success" style={{ position: 'static', margin: '0 0 16px', animation: 'none' }}>{message}</div>}

      <form className="contact-form" onSubmit={handleSubmit}>
        <label htmlFor="new-password">
          New Password
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="enter new password"
            required
            disabled={submitting}
            autoComplete="new-password"
            minLength={6}
          />
        </label>

        <label htmlFor="confirm-password">
          Confirm Password
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="confirm new password"
            required
            disabled={submitting}
            autoComplete="new-password"
            minLength={6}
          />
        </label>

        <div className="action-row" style={{ marginTop: '8px' }}>
          <button type="submit" className="form-button" disabled={submitting}>
            {submitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>

      {message && (
        <p className="muted auth-switch" style={{ marginTop: '16px', textAlign: 'center' }}>
          <NavLink to="/tasks" style={{ color: 'inherit' }}>Go to Login</NavLink>
        </p>
      )}
    </section>
  );
}

export default ResetPassword;