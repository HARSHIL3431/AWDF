import { useEffect, useState, lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import './styles/App.css';
import Home from './pages/Home';
import { authService } from './services/authService';
import { ExpandableActionBar } from './Components/ExpandableActionBar';

const Projects = lazy(() => import('./pages/Projects'));
const Contact = lazy(() => import('./pages/Contact'));
const Tasks = lazy(() => import('./pages/Tasks'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

function App() {
  const [isDarkMode, setIsDarkMode] = useState(
    () => localStorage.getItem('theme_mode') !== 'light'
  );
  const [user, setUser] = useState(() => authService.getUser());

  useEffect(() => {
    const rootElement = document.documentElement;
    rootElement.classList.toggle('theme-dark', isDarkMode);
    rootElement.classList.toggle('theme-light', !isDarkMode);
    localStorage.setItem('theme_mode', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLogout = () => {
    authService.removeToken();
    setUser(null);
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">Student Portfolio</p>
          <h1 className="site-title">Harshil Thakkar</h1>
        </div>

        <ExpandableActionBar />

        <div className="header-actions">
          {user && (
            <div className="user-chip">
              <span className="user-chip__dot" aria-hidden="true" />
              <span className="user-chip__email">{user.email}</span>
              <button
                type="button"
                className="form-button form-button--ghost"
                onClick={handleLogout}
                style={{ padding: '5px 12px', fontSize: '0.82rem' }}
              >
                Logout
              </button>
            </div>
          )}

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setIsDarkMode((currentValue) => !currentValue)}
          >
            {isDarkMode ? '☀ Light mode' : '◐ Dark mode'}
          </button>
        </div>
      </header>

      <main className="page-content">
        <Suspense
          fallback={
            <div className="loading-container" role="status" aria-live="polite">
              <div className="spinner" />
              <p>Loading page...</p>
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Navigate to="/projects/HARSHIL3431" replace />} />
            <Route path="/projects/:username" element={<Projects />} />
            <Route path="/tasks" element={<Tasks user={user} onLoginSuccess={handleLoginSuccess} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;