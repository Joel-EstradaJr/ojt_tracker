"use client";

// ============================================================
// ImportCSV — a file-upload button that sends a CSV to the
// backend import endpoint for the given trainee.
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
      // Reset file input so the same file can be re-uploaded
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
      >
        {loading ? "Importing…" : "Import CSV"}
      </button>
    </>
  );
}
