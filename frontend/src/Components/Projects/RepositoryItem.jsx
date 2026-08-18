import { getLanguageColor, formatRelativeDate } from '../../utils/githubUtils';
import { useState } from 'react';

/**
 * RepositoryItem — A single repository row in the vertical list.
 */
function RepositoryItem({ repo }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(repo.html_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may not be available */
    }
  };

  return (
    <article className="repo-item" aria-label={`Repository: ${repo.name}`}>
      <div className="repo-item__body">
        <div className="repo-item__header">
          <h3 className="repo-item__name">{repo.name}</h3>
          <span className="repo-item__visibility">{repo.visibility || (repo.private ? 'Private' : 'Public')}</span>
        </div>

        <p className="repo-item__desc">
          {repo.description || 'No description available'}
        </p>

        {repo.topics && repo.topics.length > 0 && (
          <div className="repo-item__tags">
            {repo.topics.slice(0, 5).map((topic) => (
              <span key={topic} className="repo-item__topic">{topic}</span>
            ))}
          </div>
        )}

        <ul className="repo-item__meta">
          {repo.language && (
            <li>
              <span
                className="lang-dot"
                style={{ backgroundColor: getLanguageColor(repo.language) }}
                aria-hidden="true"
              />
              {repo.language}
            </li>
          )}
          <li>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.751.751 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>
            {repo.stargazers_count.toLocaleString()}
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 000 1.5zM8 12.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z"/></svg>
            {repo.forks_count.toLocaleString()}
          </li>
          <li>
            Updated {formatRelativeDate(repo.updated_at)}
          </li>
        </ul>
      </div>

      <div className="repo-item__actions">
        <a
          href={repo.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--primary"
          aria-label={`Open ${repo.name} repository`}
        >
          Open Repo
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.75 2h3.5a.75.75 0 010 1.5h-3.5a.25.25 0 00-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25v-3.5a.75.75 0 011.5 0v3.5A1.75 1.75 0 0112.25 14h-8.5A1.75 1.75 0 012 12.25v-8.5C2 2.784 2.784 2 3.75 2zm6.854-1h4.146a.25.25 0 01.25.25v4.146a.25.25 0 01-.427.177L13.03 4.03 9.28 7.78a.751.751 0 01-1.042-.018.751.751 0 01-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0110.604 1z"/></svg>
        </a>
        <button
          className="btn btn--secondary"
          onClick={handleCopy}
          aria-label={`Copy ${repo.name} URL`}
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </div>
    </article>
  );
}

export default RepositoryItem;
