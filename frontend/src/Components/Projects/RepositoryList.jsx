import RepositoryItem from './RepositoryItem';

/**
 * RepositoryList — Vertical list container for repository items.
 */
function RepositoryList({ repos }) {
  return (
    <section className="repo-list" aria-label="Repository list">
      {repos.map((repo) => (
        <RepositoryItem key={repo.id} repo={repo} />
      ))}
    </section>
  );
}

export default RepositoryList;
