import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">404</h1>
      <p className="text-sm text-zinc-500">Aradiginiz sayfa bulunamadi.</p>
      <Link href="/" className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90">
        Ana sayfaya don
      </Link>
    </main>
  );
}
