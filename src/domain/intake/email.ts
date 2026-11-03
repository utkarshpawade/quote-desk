/**
 * Email helpers that run in the browser (when an .eml is dropped) and on the server: numbering
 * lines so evidence can point at "line 12", converting HTML mail to text, and unwrapping a mail
 * that sales forwarded internally so the real customer and date are used (A-22).
 */

export function numberLines(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, i) => `L${String(i + 1).padStart(3, "0")}: ${line}`)
    .join("\n");
}

/** Plain text from HTML mail, without regex backtracking traps; entities for the common cases. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface Forwarded {
  from: string | null;
  date: string | null;
  subject: string | null;
  /** The original message, without the forwarding header. */
  body: string;
}

/** Finds a forwarded message ("---------- Forwarded message ----------" or Outlook's From/Sent block). */
export function unwrapForwarded(text: string): Forwarded | null {
  const marker = /-{2,}\s*Forwarded message\s*-{2,}|-{2,}\s*Original Message\s*-{2,}|^From:\s.+\n(?:Sent|Date):\s.+$/im.exec(text);
  if (!marker) return null;
  const rest = text.slice(marker.index);
  const header = (name: string) => new RegExp(String.raw`^\s*${name}:\s*(.+)$`, "im").exec(rest)?.[1]?.trim() ?? null;
  const from = header("From");
  if (!from) return null;
  const bodyStart = rest.search(/\n\s*\n/);
  return {
    from,
    date: header("Date") ?? header("Sent"),
    subject: header("Subject"),
    body: bodyStart >= 0 ? rest.slice(bodyStart).trim() : rest,
  };
}

/** "Purchase Dept <purchase@companyd.example>" → "purchase@companyd.example" */
export function emailAddress(from: string): string | null {
  return /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(from)?.[0]?.toLowerCase() ?? null;
}
