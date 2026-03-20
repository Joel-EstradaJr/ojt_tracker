"use client";

import { useCallback, useRef } from "react";

export function useActionGuard() {
  const inFlightRef = useRef(new Set<string>());

  const runGuarded = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (inFlightRef.current.has(key)) {
      return undefined;
    }

    inFlightRef.current.add(key);
    try {
      return await action();
    } finally {
      inFlightRef.current.delete(key);
    }
  }, []);

  return { runGuarded };
}
