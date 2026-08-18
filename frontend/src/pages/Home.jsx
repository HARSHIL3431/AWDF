import Header from '../components/Header';
import About from '../components/About';
import Skills from '../components/Skills';
import Footer from '../components/Footer';

const skills = [
  'HTML',
  'CSS',
  'JavaScript',
  'React',
  'Python',
  'Machine Learning',
];

function Home() {
  return (
    <div className="hero-card">
      <Header
        name="Harshil Thakkar"
        role="AI & ML Student | Full Stack Developer"
      />

      <div className="hero-grid">
        <About
          title="About Me"
          description="I am passionate about Artificial Intelligence, Web Development, and creating impactful software solutions."
        />

        <section className="section-card">
          <h2>UI Analysis</h2>
          <p className="muted">
            The portfolio is structured as a reusable layout with separate
            sections for identity, background, skills, and contact details.
          </p>
          <ul className="stack-list">
            <li>Header introduces the student and role.</li>
            <li>About explains the personal summary.</li>
            <li>Skills lists the technical stack.</li>
            <li>Footer carries direct contact information.</li>
          </ul>
        </section>
      </div>

      <Skills skills={skills} />

      <section className="section-card">
        <h2>Component Re-rendering</h2>
        <p>
          React re-renders when props or state change, then updates only the
          affected parts of the UI through the virtual DOM diff.
        </p>
      </section>

      <section className="section-card">
        <h2>Why Reusability Matters</h2>
        <p>
          Reusable components reduce duplication, make large interfaces easier
          to maintain, and let teams change one piece of UI without breaking
          every page that depends on it.
        </p>
      </section>

      <Footer
        email="harshilthakkar3435@gmail.com"
        copyright="© 2026 Harshil Thakkar"
      />
    </div>
  );
}

export default Home;