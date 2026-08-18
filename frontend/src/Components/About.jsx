function About({ title, description }) {
  return (
    <section
      style={{
        padding: "20px",
      }}
    >
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

export default About;