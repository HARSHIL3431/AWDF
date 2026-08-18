/**
 * LoadingSkeleton — Shimmer placeholders for the profile, stats, and repo list.
 */
function LoadingSkeleton() {
  return (
    <div className="projects-page" aria-busy="true" aria-label="Loading content">
      {/* Skeleton Profile Hero */}
      <div className="skeleton-hero">
        <div className="skeleton skeleton-avatar" />
        <div className="skeleton-info">
          <div className="skeleton skeleton-line--lg" />
          <div className="skeleton skeleton-line--md" />
          <div className="skeleton skeleton-line--sm" />
          <div className="skeleton skeleton-line--xs" />
        </div>
      </div>

      {/* Skeleton Stats */}
      <div className="skeleton-stats">
        {[1, 2, 3, 4, 5].map((i) => (
          <div className="skeleton-stat" key={i}>
            <div className="skeleton skeleton-stat__val" />
            <div className="skeleton skeleton-stat__label" />
          </div>
        ))}
      </div>

      {/* Skeleton Toolbar */}
      <div className="skeleton skeleton-toolbar" />

      {/* Skeleton Repo List */}
      <div className="skeleton-repo-list">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton-repo-item" key={i}>
            <div className="skeleton skeleton-repo-item__title" />
            <div className="skeleton skeleton-repo-item__desc" />
            <div className="skeleton skeleton-repo-item__meta" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default LoadingSkeleton;
