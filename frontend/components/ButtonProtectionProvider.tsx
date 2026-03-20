"use client";

import { useEffect } from "react";

const CLICK_GUARD_MS = 700;

export default function ButtonProtectionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const lastClickMap = new WeakMap<HTMLButtonElement, number>();

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const button = target.closest("button") as HTMLButtonElement | null;
      if (!button) return;
      if (button.disabled) return;
      if (button.dataset.allowRapidClick === "true") return;

      const now = Date.now();
      const lastClick = lastClickMap.get(button) ?? 0;
      if (now - lastClick < CLICK_GUARD_MS) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      lastClickMap.set(button, now);
    };

    document.addEventListener("click", onClickCapture, true);
    return () => {
      document.removeEventListener("click", onClickCapture, true);
    };
  }, []);

  return <>{children}</>;
}
