import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';

// argon2id with OWASP-recommended parameters.
const opts = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, opts);
export async function verifyPassword(hashStr: string | null | undefined, pw: string) {
  if (!hashStr) return false;
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Used when an account does not exist, so login timing doesn't reveal which emails are registered.
let dummy: string | null = null;
export async function dummyVerify(pw: string) {
  dummy ??= await hashPassword('timing-equaliser-password');
  await verifyPassword(dummy, pw);
}
