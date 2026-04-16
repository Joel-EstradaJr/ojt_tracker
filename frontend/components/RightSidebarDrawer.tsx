"use client";

import { ReactNode, useEffect } from "react";

interface RightSidebarDrawerProps {
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export default function RightSidebarDrawer({ onClose, children, width = 600 }: RightSidebarDrawerProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="side-drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="side-drawer-panel"
        style={{ ["--drawer-width" as string]: `${width}px` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button type="button" className="side-drawer-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
        <div className="side-drawer-scroll">{children}</div>
      </aside>
    </div>
  );
}
