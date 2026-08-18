function Skills({ skills }) {
  return (
    <section
      style={{
        padding: "20px",
      }}
    >
      <h2>Skills</h2>

      <ul>
        {skills.map((skill, index) => (
          <li key={index}>{skill}</li>
        ))}
      </ul>
    </section>
  );
}

export default Skills;