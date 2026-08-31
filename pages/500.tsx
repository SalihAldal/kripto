export default function InternalServerErrorPage() {
  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>500</h1>
        <p>Sunucuda beklenmeyen bir hata olustu. Lutfen daha sonra tekrar deneyin.</p>
      </div>
    </main>
  );
}
