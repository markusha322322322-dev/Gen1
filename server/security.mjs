import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export const token = () => randomBytes(32).toString("hex");
export const digest = (s) => createHash("sha256").update(s).digest("hex");
export function hashPassword(p) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
}
export function verifyPassword(p, h) {
  const [s, v] = h.split(":");
  const b = Buffer.from(v, "hex");
  return b.length === 64 && timingSafeEqual(b, scryptSync(p, s, 64));
}
function key() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length < 32)
    throw Error("ENCRYPTION_KEY must contain at least 32 characters");
  return createHash("sha256").update(k).digest();
}
export function encrypt(s) {
  if (!s) return null;
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]).toString(
    "base64",
  );
}
export function decrypt(s) {
  if (!s) return "";
  const b = Buffer.from(s, "base64"),
    d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(-16));
  return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
}
export function can(role, action) {
  return (
    action === "read" ||
    action === "favorite" ||
    (action === "write" && role !== "viewer") ||
    (action === "admin" && ["owner", "admin"].includes(role)) ||
    (action === "owner" && role === "owner")
  );
}
