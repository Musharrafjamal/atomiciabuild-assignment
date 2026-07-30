import bcrypt from "bcryptjs";

/**
 * bcryptjs rather than the native `bcrypt` binding: it is pure JavaScript, so it
 * needs no native compilation and runs unchanged on Vercel.
 */
export const BCRYPT_COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
