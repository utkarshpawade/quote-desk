import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every server action is a public HTTP endpoint. This test finds each "use server" module and
 * checks that everything it exports was built with defineAction (session, permission and zod
 * validation on every call). Sign-in and sign-out are the only plain actions: they run before
 * there is a session and validate their own form input.
 */

// Importing an action module creates the Prisma client, which needs a URL but not a connection.
// (Modules are imported dynamically below, after this line has run.)
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";

/** Same registry symbol as ACTION_MARKER in src/server/action.ts. */
const ACTION_MARKER = Symbol.for("quote-desk.action");

const EXEMPT = new Set(["src/server/auth/actions.ts#login", "src/server/auth/actions.ts#logout"]);

function serverModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : serverModules(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    return /^\s*["']use server["']/.test(readFileSync(file, "utf8")) ? [file.split(path.sep).join("/")] : [];
  });
}

const modules = serverModules("src");

describe("server actions", () => {
  it("are found", () => {
    expect(modules.length).toBeGreaterThanOrEqual(6);
  });

  it.each(modules)("%s exports only actions built with defineAction", async (file) => {
    const mod = (await import(path.resolve(file))) as Record<string, unknown>;
    const exported = Object.entries(mod);
    expect(exported.length).toBeGreaterThan(0);
    for (const [name, value] of exported) {
      if (EXEMPT.has(`${file}#${name}`)) continue;
      expect(typeof value, `${file}#${name}`).toBe("function");
      expect((value as { [ACTION_MARKER]?: boolean })[ACTION_MARKER], `${file}#${name} is not wrapped in defineAction`).toBe(true);
    }
  });
});
