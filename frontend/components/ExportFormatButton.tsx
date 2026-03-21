"use client";

import { useState } from "react";

export type ExportFormat = "csv" | "excel" | "pdf";

interface ExportFormatButtonProps {
  title?: string;
  description?: string;
  buttonClassName?: string;
  loadingFormat: ExportFormat | null;
  formats?: ExportFormat[];
  onSelect: (format: ExportFormat) => void | Promise<void>;
}

const LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  excel: "EXCEL",
  pdf: "PDF",
};

export default function ExportFormatButton({
  title = "Export Records",
  description = "Choose the export format for your own records.",
  buttonClassName = "btn btn-outline",
  loadingFormat,
  formats = ["csv", "excel", "pdf"],
  onSelect,
}: ExportFormatButtonProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (format: ExportFormat) => {
    setOpen(false);
    await onSelect(format);
  };

  return (
    <>
      <button
        className={buttonClassName}
        onClick={() => setOpen(true)}
        disabled={loadingFormat !== null}
        style={{ gap: "0.35rem" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        <span>{loadingFormat ? `Exporting ${loadingFormat.toUpperCase()}...` : "Export"}</span>
        <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>▾</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => loadingFormat === null && setOpen(false)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>{title}</h2>
            <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", marginBottom: "0.9rem" }}>
              {description}
            </p>
            <div style={{ display: "grid", gap: "0.5rem", marginBottom: "0.9rem" }}>
              {formats.map((format) => (
                <button
                  key={format}
                  className="btn btn-outline"
                  onClick={() => handleSelect(format)}
                  disabled={loadingFormat !== null}
                >
                  {LABELS[format]}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setOpen(false)} disabled={loadingFormat !== null}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
