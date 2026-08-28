import { useState } from 'react';
import { authService } from '../services/authService';

function AuthForm({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.trim() || !password.trim()) {
      setError('Please fill in both email and password');
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await authService.register(email, password);
        setMessage('Registration successful! Please log in with your credentials.');
        setIsRegister(false);
        setPassword('');
      } else {
        const data = await authService.login(email, password);
        if (onLoginSuccess) {
          onLoginSuccess(data.user);
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="contact-card" style={{ maxWidth: '480px', margin: '32px auto' }}>
      <div>
        <p className="eyebrow">{isRegister ? 'Create Account' : 'Welcome Back'}</p>
        <h2>{isRegister ? 'Register' : 'Login'}</h2>
      </div>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="toast toast-success" style={{ position: 'static', margin: '0 0 16px', animation: 'none' }}>{message}</div>}

      <form className="contact-form" onSubmit={handleSubmit}>
        <label htmlFor="auth-email">
          Email
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="enter your email"
            required
            disabled={submitting}
          />
        </label>

        <label htmlFor="auth-password">
          Password
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="enter your password"
            required
            disabled={submitting}
          />
        </label>

        <div className="action-row" style={{ marginTop: '8px' }}>
          <button type="submit" className="form-button" disabled={submitting}>
            {submitting
              ? (isRegister ? 'Registering...' : 'Logging in...')
              : (isRegister ? 'Register' : 'Login')
            }
          </button>
          <button
            type="button"
            className="form-button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
              setMessage(null);
            }}
            disabled={submitting}
          >
            {isRegister ? 'Switch to Login' : 'Need an Account? Register'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default AuthForm;
