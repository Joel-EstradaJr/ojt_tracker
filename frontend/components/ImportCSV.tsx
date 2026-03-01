"use client";

// ============================================================
// ImportCSV -- file-upload button for CSV import
// ============================================================

import { useRef, useState } from "react";
import { importCSV } from "@/lib/api";

interface Props {
  traineeId: string;
  onImported: () => void;
}

export default function ImportCSV({ traineeId, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const result = await importCSV(traineeId, file);
      alert(`Successfully imported ${result.imported} log entries.`);
      onImported();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
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
        onClick={() => fileRef.current?.click()}
        style={{ gap: "0.35rem" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        {loading ? "Importing\u2026" : "Import CSV"}
      </button>
    </>
  );
}