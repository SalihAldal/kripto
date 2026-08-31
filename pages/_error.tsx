import type { NextPageContext } from "next";
import Link from "next/link";

type ErrorProps = {
  statusCode?: number;
};

function ErrorPage({ statusCode }: ErrorProps) {
  const code = statusCode ?? 500;
  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{code}</h1>
        <p style={{ marginBottom: 14 }}>Beklenmeyen bir hata olustu.</p>
        <Link href="/">Ana sayfaya don</Link>
      </div>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorProps => {
  const statusCode = res?.statusCode ?? (err ? 500 : 404);
  return { statusCode };
};

export default ErrorPage;
