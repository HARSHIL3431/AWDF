import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NavLink, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/', label: 'Home', icon: HomeIcon },
  { path: '/projects', label: 'Projects', icon: FolderIcon },
  { path: '/tasks', label: 'Tasks', icon: CheckSquareIcon },
  { path: '/contact', label: 'Contact', icon: MailIcon },
];

function HomeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function FolderIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function CheckSquareIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function MailIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

export function ExpandableActionBar() {
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const handleKeyDown = (e) => {
      if (e.key === 'Tab' && !isExpanded) {
        setIsExpanded(true);
      }
    };
    container?.addEventListener('keydown', handleKeyDown);
    return () => container?.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const handleItemClick = (path) => {
    if (path !== location.pathname) {
      setIsExpanded(false);
    }
  };

  return (
    <motion.nav
      ref={containerRef}
      className="expandable-action-bar"
      role="navigation"
      aria-label="Primary navigation"
      initial={false}
      animate={{ width: isExpanded ? 'auto' : 'auto' }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      onFocusWithin={() => setIsExpanded(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setIsExpanded(false);
        }
      }}
    >
      <ul className="action-bar-items">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `action-bar-item ${isActive ? 'active' : ''}`}
              onClick={() => handleItemClick(item.path)}
            >
              <span className="action-bar-icon">
                <item.icon className="action-bar-icon-svg" />
              </span>
              <AnimatePresence mode="wait">
                {isExpanded && (
                  <motion.span
                    className="action-bar-label"
                    initial={{ opacity: 0, width: 0, x: -8 }}
                    animate={{ opacity: 1, width: 'auto', x: 0 }}
                    exit={{ opacity: 0, width: 0, x: -8 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30, duration: 0.2 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
          </li>
        ))}
      </ul>
    </motion.nav>
  );
}

export default ExpandableActionBar;