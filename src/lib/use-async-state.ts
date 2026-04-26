"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AsyncState<T> = {
  loading: boolean;
  error: string | null;
  data: T;
};

export function useAsyncState<T>(loader: () => Promise<T>, initial: T) {
  const [state, setState] = useState<AsyncState<T>>({
    loading: true,
    error: null,
    data: initial,
  });
  const loaderRef = useRef(loader);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const run = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: !hasLoadedRef.current, error: null }));
    try {
      const data = await loaderRef.current();
      hasLoadedRef.current = true;
      setState({ loading: false, error: null, data });
    } catch (error) {
      hasLoadedRef.current = true;
      setState((prev) => ({
        loading: false,
        error: (error as Error).message || "Bilinmeyen hata",
        data: prev.data,
      }));
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return { ...state, reload: run };
}
