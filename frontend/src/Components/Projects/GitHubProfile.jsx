/**
 * GitHubProfile — Premium hero card displaying the user's GitHub profile.
 */
function GitHubProfile({ profile, username }) {
  return (
    <section className="profile-hero" aria-label="GitHub profile">
      <img
        className="profile-hero__avatar"
        src={profile.avatar_url}
        alt={`${profile.name || username}'s avatar`}
        width="120"
        height="120"
      />

      <div className="profile-hero__info">
        <h2 className="profile-hero__name">{profile.name || username}</h2>
        <p className="profile-hero__username">@{profile.login || username}</p>
        <p className="profile-hero__bio">{profile.bio || 'No bio available.'}</p>

        <ul className="profile-hero__meta">
          {profile.company && (
            <li>
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.75 16A1.75 1.75 0 010 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 00.25-.25V8.285a.25.25 0 00-.111-.208l-1.055-.703a.749.749 0 11.832-1.248l1.055.703c.487.325.777.871.777 1.456v5.965A1.75 1.75 0 0114.25 16h-3.5a.766.766 0 01-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 01-.75-.75V14h-1v1.25a.75.75 0 01-.75.75h-3zm.75-1.5h1.5a.25.25 0 00.25-.25V12.5a.75.75 0 01.75-.75h1.5a.75.75 0 01.75.75v1.75c0 .138.112.25.25.25H10V1.75a.25.25 0 00-.25-.25h-8.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25zM3.75 6h.5a.75.75 0 010 1.5h-.5a.75.75 0 010-1.5zM3 3.75A.75.75 0 013.75 3h.5a.75.75 0 010 1.5h-.5A.75.75 0 013 3.75zM3.75 9h.5a.75.75 0 010 1.5h-.5a.75.75 0 010-1.5zM7 6.75A.75.75 0 017.75 6h.5a.75.75 0 010 1.5h-.5A.75.75 0 017 6.75zM7.75 3h.5a.75.75 0 010 1.5h-.5a.75.75 0 010-1.5zM7 9.75A.75.75 0 017.75 9h.5a.75.75 0 010 1.5h-.5A.75.75 0 017 9.75z"/></svg>
              {profile.company}
            </li>
          )}
          {profile.location && (
            <li>
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.536 3.464a5 5 0 010 7.072L8 14.07l-3.536-3.535a5 5 0 117.072-7.072v.001zm-1.06 1.06a3.5 3.5 0 10-4.95 4.95L8 11.94l2.474-2.465a3.5 3.5 0 000-4.95zM8 7a1 1 0 100-2 1 1 0 000 2z"/></svg>
              {profile.location}
            </li>
          )}
          {profile.blog && (
            <li>
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z"/></svg>
              <a href={profile.blog.startsWith('http') ? profile.blog : `https://${profile.blog}`} target="_blank" rel="noopener noreferrer">{profile.blog}</a>
            </li>
          )}
          <li>
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.75.75A.75.75 0 016.5 0h3a.75.75 0 010 1.5h-1v1.27a6.5 6.5 0 01-1 12.94A6.5 6.5 0 016.27 2.77V1.5h-1V.75zm2.173 2.27a5 5 0 102.904 9.213 5 5 0 00-2.904-9.213zM8 5.5a.75.75 0 01.75.75v2.25H10a.75.75 0 010 1.5H7.25V6.25A.75.75 0 018 5.5z"/></svg>
            Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </li>
        </ul>

        <div className="profile-hero__actions">
          <a
            href={profile.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--primary"
            aria-label={`View ${profile.login}'s GitHub profile`}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

export default GitHubProfile;
