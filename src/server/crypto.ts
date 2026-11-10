import crypto from "node:crypto";
import { env } from "./env";

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function key(): Buffer {
  if (env.ENCRYPTION_KEY) {
    const k = Buffer.from(env.ENCRYPTION_KEY, "base64");
    if (k.length !== 32) throw new Error("ENCRYPTION_KEY debe ser de 32 bytes en base64");
    return k;
  }
  if (env.NODE_ENV === "production") throw new Error("Falta ENCRYPTION_KEY");
  return crypto.createHash("sha256").update(`volkra:${env.APP_SECRET}`).digest();
}

/** AES-256-GCM. Formato: iv.tag.datos (base64url) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export function hmac(value: string): string {
  return crypto.createHmac("sha256", env.APP_SECRET).update(value).digest("base64url");
}
