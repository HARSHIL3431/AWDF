function Footer({ email, copyright }) {
  return (
    <footer
      style={{
        background: "#1e293b",
        color: "white",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <p>Email: {email}</p>
      <p>{copyright}</p>
    </footer>
  );
}

export default Footer;