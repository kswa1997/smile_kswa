import { randomUUID } from 'node:crypto';
import { credentialVersion, digest, fail, hashPassword, redact, verifyPassword } from './security.js';

const collections = ['members', 'signupRequests', 'mileageRecords', 'pwRequests', 'usageRequests', 'withdrawals', 'deletionLogs'];
const passwordRule = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/;
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID()}`;
const digits = (value) => String(value || '').replace(/\D/g, '');
const text = (value, max = 500) => {
  if (typeof value !== 'string' || value.trim().length > max) fail(400, '입력 내용을 확인해주세요.');
  return value.trim();
};
const required = (value, max) => { const result = text(value, max); if (!result) fail(400, '필수 항목을 입력해주세요.'); return result; };
const newPassword = (value) => { const result = required(value, 128); if (!passwordRule.test(result)) fail(400, '비밀번호는 영어와 숫자를 혼용한 8자리입니다.'); return result; };
const phone = (value) => { const result = required(value, 30); if (!/^\d{9,11}$/.test(digits(result))) fail(400, '전화번호를 확인해주세요.'); return result; };
const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
const volume = (value) => /^\d+$/.test(normalize(value)) ? String(Number(value)) : normalize(value);

export function rows(root, collection) {
  return Object.entries(root[collection] || {}).filter(([, item]) => item && typeof item === 'object').map(([key, item]) => ({ ...item, id: item.id || key, _fbKey: key }));
}
function find(root, collection, recordId) {
  const result = rows(root, collection).find((item) => item.id === recordId);
  if (!result) fail(404, '기록을 찾을 수 없습니다.');
  return result;
}
function put(root, collection, item) {
  root[collection] ||= {};
  const { _fbKey, ...stored } = item;
  root[collection][_fbKey || item.id] = stored;
  return item;
}
function remove(root, collection, item) { delete root[collection][item._fbKey || item.id]; }
function adminRecord(root, env) {
  if (root._security?.admin?.passwordHash) return root._security.admin;
  // No published default password and no client-readable settings fallback.
  return env.ADMIN_PASSWORD_HASH ? { passwordHash: env.ADMIN_PASSWORD_HASH } : null;
}
export function principal(root, session, env = process.env) {
  if (!session) fail(401, '로그인이 필요합니다.');
  const member = session.id === 'admin' ? adminRecord(root, env) : rows(root, 'members').find((entry) => entry.id === session.id);
  if (!member || session.version !== credentialVersion(member)) fail(401, '다시 로그인해주세요.');
  return session.id === 'admin' ? { id: 'admin', name: '관리자', role: 'admin', credential: member } : { ...member, credential: member };
}
const isAdmin = (actor) => actor.id === 'admin' && actor.role === 'admin';
const canManage = (actor) => isAdmin(actor) || actor.role === 'subAdmin';
function allow(condition) { if (!condition) fail(403, '이 작업을 수행할 권한이 없습니다.'); }
export function snapshot(root, actor) {
  const data = Object.fromEntries(collections.map((key) => [key, rows(root, key)]));
  data.settings = {};
  if (!canManage(actor)) {
    data.members = data.members.filter((item) => item.id === actor.id);
    for (const key of ['mileageRecords', 'usageRequests', 'pwRequests']) data[key] = data[key].filter((item) => item.memberId === actor.id);
    for (const key of ['signupRequests', 'withdrawals', 'deletionLogs']) data[key] = [];
  } else if (!isAdmin(actor)) {
    data.signupRequests = [];
    data.withdrawals = [];
  }
  const { credential, ...user } = actor;
  return redact({ data, user, isAdmin: isAdmin(actor) });
}
export function throttle(root, key, limit, windowMs, time = Date.now()) {
  root._security ||= {};
  root._security.limits ||= {};
  const limits = root._security.limits;
  // Bound retention; hashed keys contain neither names nor IP addresses.
  for (const [name, entry] of Object.entries(limits)) if (entry.until <= time) delete limits[name];
  const hashed = digest(key);
  const bucket = limits[hashed] || { count: 0, until: time + windowMs };
  if (bucket.count >= limit) return false;
  bucket.count++;
  limits[hashed] = bucket;
  return true;
}
export function login(root, input, env = process.env) {
  const name = required(input.name, 100);
  const password = required(input.password, 128);
  if (name === 'kswa1997') {
    const record = adminRecord(root, env);
    if (!record) fail(503, '관리자 보안 비밀번호 설정이 필요합니다.');
    if (!verifyPassword(password, record)) fail(401, '이름 또는 비밀번호가 일치하지 않습니다.');
    return { id: 'admin', record };
  }
  const matches = rows(root, 'members').filter((entry) => entry.name === name).sort((a, b) => String(b.updatedAt || b.joinedAt || '').localeCompare(String(a.updatedAt || a.joinedAt || '')));
  const member = matches.find((entry) => verifyPassword(password, entry));
  if (!member) fail(401, '이름 또는 비밀번호가 일치하지 않습니다.');
  if (!member.passwordHash) member.passwordHash = hashPassword(password);
  delete member.password;
  put(root, 'members', member);
  return { id: member.id, record: member };
}
function balance(root, memberId, excluding) {
  return rows(root, 'mileageRecords').filter((item) => item.memberId === memberId && item.id !== excluding).reduce((sum, item) => sum + (item.type === 'earn' ? 1 : -1) * Number(item.amount || 0), 0);
}
function memberFields(member) { return { memberId: member.id, memberName: member.name, memberAffiliation: member.affiliation, memberPhone: member.phone }; }
function editorFields(actor) { return { editorId: actor.id, editorName: actor.name }; }
function amount(value, minimum = 1) { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > 1200000) fail(400, '마일리지 금액을 확인해주세요.'); return result; }
function passwordConfirmation(input) { const value = newPassword(input.password); if (value !== input.passwordConfirm) fail(400, '비밀번호 확인이 일치하지 않습니다.'); return value; }

export function publicAction(root, action, input) {
  if (action === 'register') {
    const name = required(input.name, 100), affiliation = required(input.affiliation, 200), number = phone(input.phone);
    if (input.privacyConsent !== true) fail(400, '개인정보 수집과 이용에 동의해주세요.');
    const password = passwordConfirmation(input);
    const duplicate = [...rows(root, 'members'), ...rows(root, 'signupRequests').filter((item) => item.status === 'pending')].some((item) => item.name === name && digits(item.phone) === digits(number));
    if (!duplicate) put(root, 'signupRequests', { id: id('signup'), name, affiliation, phone: number, passwordHash: hashPassword(password), privacyConsent: true, privacyConsentAt: now(), privacyConsentVersion: '2026-05-20', status: 'pending', requestedAt: now() });
    return { message: '가입 신청을 접수했습니다. 이미 신청한 경우 기존 신청이 유지됩니다.' };
  }
  if (action === 'requestPassword') {
    const name = required(input.name, 100), number = phone(input.phone), message = text(input.message || '');
    const member = rows(root, 'members').find((item) => item.name === name && digits(item.phone) === digits(number));
    if (member && !rows(root, 'pwRequests').some((item) => item.memberId === member.id && item.status === 'pending')) put(root, 'pwRequests', { id: id('pw'), memberId: member.id, name, phone: number, message, status: 'pending', createdAt: now() });
    return { message: '등록 정보가 일치하면 관리자에게 요청이 전달됩니다. 학회에 본인 확인 후 비밀번호 재설정을 문의해주세요.' };
  }
  fail(400, '지원하지 않는 작업입니다.');
}

export function bootstrapAdmin(root, input, env = process.env) {
  if (root._security?.admin?.passwordHash || env.ADMIN_PASSWORD_HASH) fail(409, '관리자 보안 설정이 이미 완료되었습니다.');
  root._security ||= {};
  const record = { passwordHash: hashPassword(passwordConfirmation(input)), updatedAt: now() };
  root._security.admin = record;
  if (root.settings) { delete root.settings.adminPassword; delete root.settings.adminPasswordHash; }
  return { id: 'admin', record };
}

export function mutate(root, actor, action, input, env = process.env) {
  switch (action) {
    case 'approveSignup': {
      allow(isAdmin(actor));
      const request = find(root, 'signupRequests', input.id);
      if (request.status !== 'pending') fail(409, '이미 처리된 신청입니다.');
      const existing = rows(root, 'members').some((item) => item.name === request.name && digits(item.phone) === digits(request.phone));
      if (existing) fail(409, '이미 등록된 회원입니다.');
      const member = { id: id('member'), name: request.name, affiliation: request.affiliation, phone: request.phone, role: 'member', privacyConsent: Boolean(request.privacyConsent), privacyConsentAt: request.privacyConsentAt || '', privacyConsentVersion: request.privacyConsentVersion || '', joinedAt: now(), updatedAt: now() };
      if (!request.passwordHash && !request.password) fail(400, '비밀번호가 없는 가입 신청입니다.');
      member.passwordHash = request.passwordHash || hashPassword(request.password);
      put(root, 'members', member);
      delete request.password; delete request.passwordHash;
      put(root, 'signupRequests', { ...request, status: 'approved', reviewedAt: now() });
      break;
    }
    case 'rejectSignup': {
      allow(isAdmin(actor));
      const request = find(root, 'signupRequests', input.id);
      if (request.status !== 'pending') fail(409, '이미 처리된 신청입니다.');
      delete request.password; delete request.passwordHash;
      put(root, 'signupRequests', { ...request, status: 'rejected', reviewedAt: now() });
      break;
    }
    case 'toggleSubAdmin': {
      allow(isAdmin(actor));
      const member = find(root, 'members', input.id);
      const selected = member.role === 'subAdmin';
      if (!selected && rows(root, 'members').filter((entry) => entry.role === 'subAdmin').length >= 4) fail(400, '부관리자는 최대 4명까지 지정할 수 있습니다.');
      put(root, 'members', { ...member, role: selected ? 'member' : 'subAdmin', updatedAt: now() });
      break;
    }
    case 'forceWithdraw': {
      allow(isAdmin(actor));
      const member = find(root, 'members', input.id);
      put(root, 'withdrawals', { id: id('withdraw'), ...memberFields(member), name: member.name, affiliation: member.affiliation, phone: member.phone, withdrawnAt: now(), withdrawnBy: actor.name });
      remove(root, 'members', member);
      break;
    }
    case 'saveMileage': {
      allow(canManage(actor));
      const form = input.form || {};
      const member = find(root, 'members', form.memberId);
      const previous = input.id ? find(root, 'mileageRecords', input.id) : null;
      if (!['earn', 'use', 'deduct'].includes(form.type)) fail(400, '마일리지 구분을 확인해주세요.');
      const value = form.type === 'earn' ? 30000 : amount(form.amount);
      const v = required(form.volume, 50), issue = required(form.issue, 50), title = required(form.paperTitle, 500);
      const other = rows(root, 'mileageRecords').filter((item) => item.id !== previous?.id);
      if (form.type === 'earn' && other.some((item) => item.type === 'earn' && item.memberId === member.id && volume(item.volume) === volume(v) && volume(item.issue) === volume(issue) && normalize(item.paperTitle) === normalize(title))) fail(409, '동일한 논문에 이미 적립된 마일리지가 있습니다.');
      const current = balance(root, member.id, previous?.id);
      const next = current + (form.type === 'earn' ? value : -value);
      if (next < 0 || next > 1200000) fail(400, '잔여 마일리지 또는 최대 적립 한도를 초과합니다.');
      if (previous && previous.memberId !== member.id) {
        const oldBalance = balance(root, previous.memberId, previous.id);
        if (oldBalance < 0 || oldBalance > 1200000) fail(400, '기존 회원의 잔여 마일리지 한도를 초과합니다.');
      }
      put(root, 'mileageRecords', { ...(previous || {}), id: previous?.id || id('mileage'), ...memberFields(member), type: form.type, amount: value, volume: v, issue, paperTitle: title, note: text(form.note || ''), createdAt: previous?.createdAt || now(), updatedAt: now(), ...editorFields(actor) });
      break;
    }
    case 'deleteMileage': {
      allow(canManage(actor));
      const record = find(root, 'mileageRecords', input.id);
      remove(root, 'mileageRecords', record);
      audit(root, actor, 'mileage', '마일리지 기록', [record], '관리자 기록 삭제');
      break;
    }
    case 'deleteHistory': {
      const config = { signup: ['signupRequests', '가입 승인 기록'], usage: ['usageRequests', '사용 요청 기록'], pw: ['pwRequests', '비번 요청 기록'], mileageUse: ['mileageRecords', '마일리지 사용 기록'] }[input.kind];
      allow(Boolean(config) && (input.kind === 'signup' ? isAdmin(actor) : canManage(actor)));
      if (!verifyPassword(text(input.password, 128), actor.credential)) fail(401, '현재 로그인 비밀번호가 일치하지 않습니다.');
      const reason = required(input.reason);
      if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 500) fail(400, '삭제할 기록을 확인해주세요.');
      const targets = [...new Set(input.ids)].map((value) => find(root, config[0], value));
      if (targets.some((item) => input.kind === 'mileageUse' ? item.type !== 'use' : !item.status || item.status === 'pending')) fail(400, '처리가 완료된 기록만 삭제할 수 있습니다.');
      for (const item of targets) remove(root, config[0], item);
      audit(root, actor, input.kind, config[1], targets, reason);
      break;
    }
    case 'submitUsage': {
      allow(!isAdmin(actor));
      const value = amount(input.amount, 100000);
      const pending = rows(root, 'usageRequests').filter((item) => item.memberId === actor.id && item.status === 'pending').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (value + pending > balance(root, actor.id)) fail(400, '기존 대기 요청을 포함하면 보유 마일리지를 초과합니다.');
      put(root, 'usageRequests', { id: id('usage'), ...memberFields(actor), amount: value, note: text(input.note || ''), status: 'pending', createdAt: now() });
      break;
    }
    case 'approveUsage':
    case 'rejectUsage': {
      allow(canManage(actor));
      const request = find(root, 'usageRequests', input.id);
      if (request.status !== 'pending') fail(409, '이미 처리된 요청입니다.');
      if (action === 'approveUsage') {
        const member = find(root, 'members', request.memberId), value = amount(request.amount, 100000);
        if (value > balance(root, member.id)) fail(400, '현재 잔여 마일리지를 초과합니다.');
        put(root, 'mileageRecords', { id: id('mileage'), ...memberFields(member), type: 'use', amount: value, volume: '', issue: '', paperTitle: '', note: request.note ? `사용 요청 승인: ${request.note}` : '사용 요청 승인', relatedUsageRequestId: request.id, createdAt: now(), updatedAt: now(), ...editorFields(actor) });
      }
      put(root, 'usageRequests', { ...request, status: action === 'approveUsage' ? 'approved' : 'rejected', reviewedAt: now(), reviewedBy: actor.name });
      break;
    }
    case 'updateProfile': {
      allow(!isAdmin(actor));
      const member = find(root, 'members', actor.id);
      member.affiliation = required(input.affiliation, 200); member.phone = phone(input.phone); member.updatedAt = now();
      if (input.password || input.passwordConfirm) { member.passwordHash = hashPassword(passwordConfirmation(input)); delete member.password; }
      put(root, 'members', member);
      break;
    }
    case 'updateAdminPassword': {
      allow(isAdmin(actor));
      if (!verifyPassword(text(input.currentPassword, 128), actor.credential)) fail(401, '현재 비밀번호가 일치하지 않습니다.');
      const passwordHash = hashPassword(passwordConfirmation(input));
      root._security ||= {}; root._security.admin = { passwordHash, updatedAt: now() };
      // The old settings credential is no longer used for authentication.
      if (root.settings) { delete root.settings.adminPassword; delete root.settings.adminPasswordHash; }
      break;
    }
    case 'resolvePassword': {
      allow(canManage(actor));
      const request = find(root, 'pwRequests', input.id);
      delete request.resolvedPassword;
      put(root, 'pwRequests', { ...request, status: 'done', resolvedAt: now() });
      break;
    }
    default: fail(400, '지원하지 않는 작업입니다.');
  }
  // Re-read current server authority; password changes issue a fresh session.
  const record = actor.id === 'admin' ? adminRecord(root, env) : find(root, 'members', actor.id);
  const nextActor = actor.id === 'admin' ? { ...actor, credential: record } : { ...record, credential: record };
  return { ...snapshot(root, nextActor), credential: record };
}
function audit(root, actor, kind, label, targets, reason) {
  put(root, 'deletionLogs', { id: id('deleteLog'), kind, label, count: targets.length, reason, deletedAt: now(), deletedBy: actor.name, deleterId: actor.id, deletedRecords: redact(targets).map(({ _fbKey, ...item }) => item) });
}
