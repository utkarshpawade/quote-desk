import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node — no native dependency).
 * Stored format: scrypt$N$r$p$<salt b64url>$<key b64url>, so parameters can be raised later
 * without invalidating existing hashes.
 */

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, opts: ScryptOptions, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: MAX_MEM }, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await derive(
    password,
    Buffer.from(saltB64, "base64url"),
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM },
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash of a random password, verified against when the email is unknown (equal timing). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
