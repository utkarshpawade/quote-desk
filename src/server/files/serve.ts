/**
 * Response headers for stored files. The content type always comes from our whitelist (never
 * sniffed), and the filename is encoded per RFC 5987 so names with characters outside Latin-1
 * (an en dash, a Devanagari name) cannot break the header.
 */

export const SERVABLE_TYPES: Record<string, { inline: boolean }> = {
  "application/pdf": { inline: true },
  "image/png": { inline: true },
  "image/jpeg": { inline: true },
  "text/plain": { inline: false },
  "message/rfc822": { inline: false },
  "text/csv": { inline: false },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { inline: false },
  "application/vnd.ms-excel": { inline: false },
};

export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function fileHeaders(file: { filename: string; mimeType: string; sizeBytes: number }, wantInline: boolean): HeadersInit {
  const type = SERVABLE_TYPES[file.mimeType] ? file.mimeType : "application/octet-stream";
  const inline = wantInline && Boolean(SERVABLE_TYPES[type]?.inline);
  return {
    "Content-Type": type,
    "Content-Length": String(file.sizeBytes),
    "Content-Disposition": contentDisposition(file.filename, inline),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // Framable only by the app itself (in-app drawing preview); never by other sites.
    "Content-Security-Policy": "frame-ancestors 'self'; default-src 'none'; style-src 'unsafe-inline'",
    "X-Frame-Options": "SAMEORIGIN",
  };
}
