import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>404</h1>
        <p style={{ marginBottom: 14 }}>Aradiginiz sayfa bulunamadi.</p>
        <Link href="/">Ana sayfaya don</Link>
      </div>
    </main>
  );
}
