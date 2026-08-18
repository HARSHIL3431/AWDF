function Header({ name, role }) {
  return (
    <header
      style={{
        background: "#1e293b",
        color: "white",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <h1>{name}</h1>
      <p>{role}</p>
    </header>
  );
}

export default Header;