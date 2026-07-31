"use client";

import { useCallback, useMemo, useState } from "react";

export type ToastTone = "success" | "error" | "info";
export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const row = { id, message, tone };
    setItems((prev) => [row, ...prev].slice(0, 4));
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 3500);
  }, []);

  const clear = useCallback(() => setItems([]), []);
  return useMemo(() => ({ items, push, clear }), [items, push, clear]);
}
