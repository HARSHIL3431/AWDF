import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import './styles/App.css';
import Home from './pages/Home';
import Projects from './pages/Projects';
import Contact from './pages/Contact';
import Tasks from './pages/Tasks';
import NotFound from './pages/NotFound';
import { authService } from './services/authService';

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

        <nav className="nav-links" aria-label="Primary navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </nav>

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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Navigate to="/projects/HARSHIL3431" replace />} />
          <Route path="/projects/:username" element={<Projects />} />
          <Route path="/tasks" element={<Tasks user={user} onLoginSuccess={handleLoginSuccess} />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;