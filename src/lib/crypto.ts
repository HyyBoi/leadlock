import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 32) throw new Error("ENCRYPTION_KEY is missing or too short");
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Show only the last 4 characters of a secret. */
export const mask = (s?: string | null) => (s ? `••••${s.slice(-4)}` : "");
