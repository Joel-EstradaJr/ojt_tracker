export type ExportCell = string | number | boolean | null | undefined;
export type ExportRow = Record<string, ExportCell>;

function sanitizeFileName(base: string, ext: string): string {
  const cleaned = base.trim().replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
  const stem = cleaned || "export";
  return `${stem}.${ext}`;
}

function toCellString(value: ExportCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function escapeCSV(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportRowsAsCSV(fileNameBase: string, rows: ExportRow[], headers?: string[]): void {
  const columns = headers && headers.length > 0
    ? headers
    : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

  const csvLines = [
    columns.map(escapeCSV).join(","),
    ...rows.map((row) => columns.map((column) => escapeCSV(toCellString(row[column]))).join(",")),
  ];

  const csv = csvLines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, sanitizeFileName(fileNameBase, "csv"));
}

export async function exportRowsAsExcel(fileNameBase: string, rows: ExportRow[], sheetName = "Export"): Promise<void> {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || "Export");
  XLSX.writeFile(workbook, sanitizeFileName(fileNameBase, "xlsx"));
}

export async function exportElementToPdf(options: {
  element: HTMLElement;
  fileNameBase: string;
  orientation?: "portrait" | "landscape";
}): Promise<void> {
  const { element, fileNameBase, orientation = "portrait" } = options;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const pdf = new jsPDF({
    orientation,
    unit: "pt",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableWidth = pageWidth - (margin * 2);
  const usableHeight = pageHeight - (margin * 2);

  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  const targetHeight = (sourceHeight * usableWidth) / sourceWidth;

  if (targetHeight <= usableHeight) {
    const imgData = canvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", margin, margin, usableWidth, targetHeight, undefined, "FAST");
  } else {
    const pageHeightPx = Math.floor((usableHeight * sourceWidth) / usableWidth);
    let offsetY = 0;
    let pageIndex = 0;

    while (offsetY < sourceHeight) {
      const sliceHeight = Math.min(pageHeightPx, sourceHeight - offsetY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = sourceWidth;
      pageCanvas.height = sliceHeight;

      const ctx = pageCanvas.getContext("2d");
      if (!ctx) break;

      ctx.drawImage(
        canvas,
        0,
        offsetY,
        sourceWidth,
        sliceHeight,
        0,
        0,
        sourceWidth,
        sliceHeight,
      );

      const pageImg = pageCanvas.toDataURL("image/png");
      const pageImgHeight = (sliceHeight * usableWidth) / sourceWidth;
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(pageImg, "PNG", margin, margin, usableWidth, pageImgHeight, undefined, "FAST");

      offsetY += sliceHeight;
      pageIndex += 1;
    }
  }

  pdf.save(sanitizeFileName(fileNameBase, "pdf"));
}
