"use client";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Bir hata olustu</h1>
      <p className="text-sm text-zinc-500">
        Uygulama beklenmeyen bir hata ile karsilasti. Lutfen tekrar deneyin.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Tekrar dene
      </button>
      {process.env.NODE_ENV !== "production" ? (
        <pre className="w-full overflow-auto rounded-md bg-zinc-100 p-3 text-left text-xs text-zinc-700">
          {error.message}
        </pre>
      ) : null}
    </main>
  );
}
