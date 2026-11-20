import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must contain 32 bytes in hex.");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, tag, content] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex"),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content), decipher.final()]).toString(
    "utf8",
  );
}
export function sign(value: string, key = process.env.FACEBOOK_APP_SECRET!) {
  return createHmac("sha256", key).update(value).digest("hex");
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
