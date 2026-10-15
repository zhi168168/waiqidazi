import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [salt] = stored.split(":");
  const actual = Buffer.from(passwordHash(password, salt)),
    expected = Buffer.from(stored);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
