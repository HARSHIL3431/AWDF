/**
 * EmptyState — Displayed when there are no repositories or search results.
 */
function EmptyState({ type }) {
  const content = {
    no_repos: {
      heading: 'No repositories',
      description: 'This user doesn\'t have any public repositories yet.',
    },
    no_results: {
      heading: 'No results found',
      description: 'Try adjusting your search or filter to find what you\'re looking for.',
    },
  };

  const { heading, description } = content[type] || content.no_repos;

  return (
    <div className="state-card" role="status">
      <svg className="state-card__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 00.25-.25V6h-2.75A1.75 1.75 0 019 4.25V1.5zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011z" />
      </svg>
      <h3 className="state-card__heading">{heading}</h3>
      <p className="state-card__desc">{description}</p>
    </div>
  );
}

export default EmptyState;
