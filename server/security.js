import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
export const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
export function setupToken(secret, time = Date.now()) {
  return createHmac('sha256', secret).update(`smile-admin-setup:${Math.floor(time / 3600000)}`).digest('hex');
}
export function validSetupToken(token, secret, time = Date.now()) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return [time, time - 3600000].some((instant) => timingSafeEqual(Buffer.from(token), Buffer.from(setupToken(secret, instant))));
}
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, record) {
  if (typeof password !== 'string' || password.length > 128) return false;
  if (record?.passwordHash) {
    const [scheme, salt, hex] = record.passwordHash.split(':');
    if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false;
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hex, 'hex'));
  }
  // Legacy passwords are checked only on the server and upgraded after login.
  return typeof record?.password === 'string' && timingSafeEqual(Buffer.from(digest(password)), Buffer.from(digest(record.password)));
}
export function credentialVersion(record) { return digest(record?.passwordHash || record?.password || 'disabled'); }
export function signSession(id, record, secret, now = Date.now()) {
  if (!secret || secret.length < 32) fail(503, '서버 인증 설정이 필요합니다.');
  const payload = Buffer.from(JSON.stringify({ id, version: credentialVersion(record), exp: now + 8 * 3600000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function readSession(token, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof token !== 'string' || token.length > 2048) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof value.id === 'string' && Number.isFinite(value.exp) && value.exp > now ? value : null;
  } catch { return null; }
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['password', 'passwordHash', 'adminPassword', 'adminPasswordHash', 'resolvedPassword', '_security'].includes(key)).map(([key, item]) => [key, redact(item)]));
}
