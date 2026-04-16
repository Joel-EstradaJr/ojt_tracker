"use client";

import { ReactNode } from "react";

interface PageHeadingProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  meta?: ReactNode;
}

export default function PageHeading({ title, subtitle, actions, toolbar, meta }: PageHeadingProps) {
  return (
    <div className="hero-header">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {actions && <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>{actions}</div>}
      </div>

      {(toolbar || meta) && (
        <div className="hero-actions" style={{ marginTop: "1.25rem" }}>
          {toolbar}
          {meta && (
            <div style={{ marginLeft: "auto", textAlign: "right", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.3 }}>
              {meta}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
