/**
 * Canonical JSON for frozen quote snapshots (DESIGN.md §4.4). The text is stored as-is and its
 * SHA-256 is taken over exactly these bytes, so the serialization must be deterministic:
 * object keys sorted recursively, no whitespace, decimals carried as strings (a float would make
 * the bytes depend on the platform), dates as "YYYY-MM-DD" strings.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${path}: only integers may be numbers in a snapshot; use a decimal string for ${value}`);
      }
      return String(value);
    case "object": {
      if (value instanceof Date) throw new TypeError(`${path}: dates must be "YYYY-MM-DD" strings`);
      if (Array.isArray(value)) return `[${value.map((v, i) => serialize(v ?? null, `${path}[${i}]`)).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`${path}: ${typeof value} cannot be stored in a snapshot`);
  }
}
