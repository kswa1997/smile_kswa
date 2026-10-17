import { createSign } from 'node:crypto';
import { fail } from './security.js';

let cachedToken;
async function accessToken() {
  if (cachedToken?.expires > Date.now() + 60000) return cachedToken.value;
  let account;
  try { account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}'); } catch { fail(503, 'Firebase 서버 인증 설정이 필요합니다.'); }
  if (account.project_id !== 'smile-of-kswa' || !account.client_email || !account.private_key) fail(503, 'Firebase 서버 인증 설정이 필요합니다.');
  const issued = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(body).sign(account.private_key, 'base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${signature}` }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) fail(503, 'Firebase 서버 인증에 실패했습니다.');
  const result = await response.json();
  cachedToken = { value: result.access_token, expires: Date.now() + result.expires_in * 1000 };
  return cachedToken.value;
}
async function request(method, options = {}) {
  const token = await accessToken();
  return fetch('https://smile-of-kswa-default-rtdb.firebaseio.com/.json', { method, ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(15000) });
}
export async function loadDatabase() {
  const response = await request('GET');
  if (!response.ok) fail(503, '데이터를 불러오지 못했습니다.');
  return (await response.json()) || {};
}
// Compare-and-swap keeps approvals, balances and audit logs in one commit.
export async function transactDatabase(change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request('GET', { headers: { 'X-Firebase-ETag': 'true' } });
    if (!response.ok) fail(503, '데이터를 불러오지 못했습니다.');
    const tag = response.headers.get('etag');
    if (!tag) fail(503, '데이터 버전을 확인하지 못했습니다.');
    const root = (await response.json()) || {};
    const result = await change(root);
    const saved = await request('PUT', { headers: { 'Content-Type': 'application/json', 'if-match': tag }, body: JSON.stringify(root) });
    if (saved.status === 412) continue;
    if (!saved.ok) fail(503, '데이터를 저장하지 못했습니다.');
    return result;
  }
  fail(409, '다른 작업이 처리 중입니다. 잠시 후 다시 시도해주세요.');
}
