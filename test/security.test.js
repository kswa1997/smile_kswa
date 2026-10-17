import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signSession, readSession, credentialVersion, setupToken, validSetupToken } from '../server/security.js';
import { bootstrapAdmin, login, principal, snapshot, mutate, publicAction, throttle } from '../server/service.js';
import { createHandler } from '../api/app.js';

const secret = 'test-only-session-secret-with-at-least-32-bytes';
const adminHash = hashPassword('admin123');
const env = { SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: adminHash };
const fixture = () => ({ members: { a: { id: 'a', name: '회원A', password: 'pass1234', role: 'member', phone: '01012345678', affiliation: '학회' }, b: { id: 'b', name: '회원B', password: 'other123', role: 'member', phone: '01023456789', affiliation: '대학' }, c: { id: 'c', name: '부관리자', password: 'staff123', role: 'subAdmin' } }, mileageRecords: { m1: { id: 'm1', memberId: 'a', type: 'earn', amount: 300000 }, m2: { id: 'm2', memberId: 'b', type: 'earn', amount: 500000 } }, settings: { adminPassword: 'legacy-secret' }, messages: { keep: { content: '기존 데이터' } } });
function actor(root, name = '회원A', password = 'pass1234') {
  const authenticated = login(root, { name, password }, env);
  return principal(root, readSession(signSession(authenticated.id, authenticated.record, secret), secret), env);
}
function assertStatus(fn, status) { assert.throws(fn, (error) => error.status === status); }

test('sessions reject tampering, expiry, deleted members and old password versions', () => {
  const root = fixture(), user = actor(root);
  const token = signSession(user.id, user.credential, secret, 1000);
  assert.equal(readSession(`${token}x`, secret, 2000), null);
  assert.equal(readSession(token, secret, 1000 + 8 * 3600000), null);
  const session = { id: 'a', version: credentialVersion(user.credential) };
  root.members.a.passwordHash = hashPassword('changed1');
  assertStatus(() => principal(root, session, env), 401);
  delete root.members.a;
  assertStatus(() => principal(root, session, env), 401);
  assertStatus(() => principal(root, null, env), 401);
});
test('legacy passwords migrate to salted hashes and never appear in any snapshot', () => {
  const root = fixture(), user = actor(root);
  assert.equal(root.members.a.password, undefined);
  assert.ok(verifyPassword('pass1234', root.members.a));
  const state = snapshot(root, user);
  assert.deepEqual(state.data.members.map((item) => item.id), ['a']);
  assert.deepEqual(state.data.mileageRecords.map((item) => item.memberId), ['a']);
  const admin = actor(root, 'kswa1997', 'admin123');
  assert.equal(snapshot(root, admin).data.members.length, 3);
  assert.doesNotMatch(JSON.stringify(snapshot(root, admin)), /password|legacy-secret|pass1234|other123|staff123/i);
  assert.equal(root.messages.keep.content, '기존 데이터');
});
test('default admin password and local/member admin role cannot grant admin access', () => {
  const root = fixture();
  assertStatus(() => login(root, { name: 'kswa1997', password: 'love1004' }, {}), 503);
  root.members.a.role = 'admin';
  const user = actor(root);
  assert.equal(snapshot(root, user).isAdmin, false);
  assertStatus(() => mutate(root, user, 'toggleSubAdmin', { id: 'b' }, env), 403);
});
test('member cannot edit balances, approve requests or assign roles', () => {
  const root = fixture(), user = actor(root);
  for (const action of ['saveMileage', 'approveSignup', 'toggleSubAdmin', 'forceWithdraw', 'deleteMileage', 'resolvePassword']) assertStatus(() => mutate(root, user, action, { id: 'b', form: {} }, env), 403);
  const result = mutate(root, user, 'updateProfile', { affiliation: '새 소속', phone: '01012345678', role: 'subAdmin', id: 'b', name: '위조' }, env);
  assert.equal(root.members.a.role, 'member');
  assert.equal(root.members.a.name, '회원A');
  assert.equal(root.members.b.affiliation, '대학');
  assert.equal(result.user.id, 'a');
});
test('subadmin cannot approve registration or grant privileges', () => {
  const root = fixture(), staff = actor(root, '부관리자', 'staff123');
  assertStatus(() => mutate(root, staff, 'approveSignup', { id: 'any' }, env), 403);
  assertStatus(() => mutate(root, staff, 'toggleSubAdmin', { id: 'a' }, env), 403);
});
test('pending usage is reserved and approval is atomic and cannot be repeated', () => {
  const root = fixture(), user = actor(root);
  mutate(root, user, 'submitUsage', { amount: 200000, note: '' }, env);
  assertStatus(() => mutate(root, user, 'submitUsage', { amount: 200000, note: '' }, env), 400);
  const request = Object.values(root.usageRequests)[0];
  assert.equal(request.memberId, 'a');
  const admin = actor(root, 'kswa1997', 'admin123');
  mutate(root, admin, 'approveUsage', { id: request.id }, env);
  assert.equal(root.usageRequests[request.id].status, 'approved');
  assert.equal(Object.values(root.mileageRecords).filter((item) => item.relatedUsageRequestId === request.id).length, 1);
  assertStatus(() => mutate(root, admin, 'approveUsage', { id: request.id }, env), 409);
});
test('registration hashes password; approval never copies plaintext', () => {
  const root = fixture();
  publicAction(root, 'register', { name: '신규', affiliation: '대학', phone: '01034567890', password: 'new12345', passwordConfirm: 'new12345', privacyConsent: true, role: 'subAdmin' });
  const request = Object.values(root.signupRequests)[0];
  assert.equal(request.password, undefined);
  assert.ok(verifyPassword('new12345', request));
  mutate(root, actor(root, 'kswa1997', 'admin123'), 'approveSignup', { id: request.id }, env);
  const member = Object.values(root.members).find((item) => item.name === '신규');
  assert.equal(member.role, 'member');
  assert.equal(member.password, undefined);
  assert.ok(verifyPassword('new12345', member));
});
test('durable throttling limits distributed account attempts and expires', () => {
  const root = {};
  assert.ok(throttle(root, 'identity', 2, 1000, 100));
  assert.ok(throttle(root, 'identity', 2, 1000, 200));
  assert.equal(throttle(root, 'identity', 2, 1000, 300), false);
  assert.ok(throttle(root, 'identity', 2, 1000, 1100));
});
test('admin bootstrap requires a secret expiring token and can only run once', () => {
  const token = setupToken(secret, 10000000);
  assert.ok(validSetupToken(token, secret, 10000000));
  assert.equal(validSetupToken('0'.repeat(64), secret, 10000000), false);
  assert.equal(validSetupToken(token, secret, 10000000 + 7200000), false);
  const root = fixture();
  bootstrapAdmin(root, { password: 'newadm12', passwordConfirm: 'newadm12' }, {});
  assert.equal(root.settings.adminPassword, undefined);
  assert.ok(verifyPassword('newadm12', root._security.admin));
  assertStatus(() => bootstrapAdmin(root, { password: 'next1234', passwordConfirm: 'next1234' }, {}), 409);
});
test('API rejects missing authentication, CSRF and cross-origin requests; cookies are HttpOnly', async () => {
  let root = fixture();
  const handler = createHandler({ env, load: async () => structuredClone(root), transact: async (change) => { const copy = structuredClone(root); const result = await change(copy); root = copy; return result; } });
  async function request(action, input = {}, headers = {}) {
    const result = { headers: {}, statusCode: 200 };
    const res = { setHeader: (key, value) => { result.headers[key] = value; }, status: (code) => { result.statusCode = code; return res; }, json: (payload) => { result.body = payload; return result; } };
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', 'x-smile-request': '1', ...headers }, body: { action, input }, socket: { remoteAddress: '127.0.0.1' } }, res);
    return result;
  }
  assert.equal((await request('state')).statusCode, 401);
  assert.equal((await request('state', {}, { origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await request('state', {}, { 'x-smile-request': '' })).statusCode, 403);
  const logged = await request('login', { name: '회원A', password: 'pass1234' });
  assert.equal(logged.statusCode, 200);
  assert.match(logged.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(JSON.stringify(logged.body), /passwordHash|pass1234|other123/);
  const state = await request('state', {}, { cookie: logged.headers['Set-Cookie'].split(';')[0] });
  assert.equal(state.statusCode, 200);
  assert.equal(state.body.data.members.length, 1);
});
