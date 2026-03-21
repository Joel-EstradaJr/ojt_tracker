"use client";

// ============================================================
// ImportCSV -- file-upload button for CSV import
// ============================================================

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImportCsvResult, importCSV } from "@/lib/api";

interface Props {
  traineeId: string;
  onImported: () => void;
}

export default function ImportCSV({ traineeId, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportCsvResult | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const reset = () => {
    setSelectedFile(null);
    setError("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    if (loading) return;
    setOpen(false);
    reset();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setError("");
  };

  const handleImport = async () => {
    if (!selectedFile) {
      setError("Please choose a CSV file first.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await importCSV(traineeId, selectedFile);
      setResult(response);
      onImported();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <button
        className="btn btn-outline"
        disabled={loading}
        onClick={() => setOpen(true)}
        style={{ gap: "0.35rem" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        {loading ? "Importing\u2026" : "Import CSV"}
      </button>

      {open && mounted && createPortal(
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Import CSV</h2>
            <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", marginBottom: "0.8rem" }}>
              Select a CSV file to import entry logs.
            </p>

            {!result && (
              <>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label>CSV File</label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                {selectedFile && (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
                    Selected: {selectedFile.name}
                  </p>
                )}

                {error && (
                  <div style={{ marginBottom: "0.75rem", padding: "0.6rem 0.75rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.84rem" }}>
                    {error}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                  <button className="btn btn-outline" onClick={close} disabled={loading}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleImport} disabled={loading || !selectedFile}>
                    {loading ? "Importing..." : "Import"}
                  </button>
                </div>
              </>
            )}

            {result && (
              <>
                <h3 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Import Completed</h3>
                <div style={{ display: "grid", gap: "0.35rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  <div>Records Imported: <strong>{result.imported}</strong></div>
                  <div>Records Skipped (Duplicates/Invalid): <strong>{result.skipped}</strong></div>
                </div>

                {result.skippedDetails && result.skippedDetails.length > 0 && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-subtle)", maxHeight: "170px", overflowY: "auto", padding: "0.55rem", marginBottom: "0.75rem" }}>
                    {result.skippedDetails.map((detail, idx) => (
                      <div key={`${detail}-${idx}`} style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                        {detail}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn btn-primary" onClick={close}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}