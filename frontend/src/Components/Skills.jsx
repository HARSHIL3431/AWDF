function Skills({ skills }) {
  return (
    <section className="section-card skills-block">
      <h2>Skills</h2>

      <ul className="stack-list">
        {skills.map((skill, index) => (
          <li key={skill}>{skill}{index < skills.length - 1 ? ',' : '.'}</li>
        ))}
      </ul>
    </section>
  );
}

export default Skills;
