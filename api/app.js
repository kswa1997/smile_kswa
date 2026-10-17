import { loadDatabase, transactDatabase } from '../server/database.js';
import { fail, readSession, signSession, validSetupToken } from '../server/security.js';
import { bootstrapAdmin, login, mutate, principal, publicAction, snapshot, throttle } from '../server/service.js';

const cookieName = '__Host-smile_session';
function cookie(token = '', maxAge = 28800) {
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function createHandler({ load = loadDatabase, transact = transactDatabase, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); fail(405, 'POST 요청만 허용됩니다.'); }
      // JSON + a fixed same-origin header prevent cross-site form submissions.
      if (!String(req.headers['content-type'] || '').startsWith('application/json') || req.headers['x-smile-request'] !== '1') fail(403, '올바르지 않은 요청입니다.');
      const allowedOrigin = env.APP_ORIGIN || 'https://smile-kswa.vercel.app';
      if (req.headers.origin && req.headers.origin !== allowedOrigin) fail(403, '허용되지 않은 사이트의 요청입니다.');
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail(503, '서버 인증 설정이 필요합니다.');
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (Buffer.byteLength(raw) > 32768) fail(413, '요청 내용이 너무 큽니다.');
      let body;
      try { body = JSON.parse(raw); } catch { fail(400, '요청 형식을 확인해주세요.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) fail(400, '요청 형식을 확인해주세요.');
      const { action, input } = body;
      if (action === 'logout') { res.setHeader('Set-Cookie', cookie('', 0)); return res.status(200).json({ ok: true }); }
      if (action === 'bootstrapAdmin') {
        if (!validSetupToken(input.token, env.SESSION_SECRET)) fail(403, '관리자 설정 링크가 만료되었거나 올바르지 않습니다.');
        const result = await transact((root) => {
          const authenticated = bootstrapAdmin(root, input, env);
          const token = signSession(authenticated.id, authenticated.record, env.SESSION_SECRET);
          return { token, ...snapshot(root, principal(root, readSession(token, env.SESSION_SECRET), env)) };
        });
        const { token, ...payload } = result;
        res.setHeader('Set-Cookie', cookie(token));
        return res.status(200).json(payload);
      }
      if (['login', 'register', 'requestPassword'].includes(action)) {
        // Vercel sets x-vercel-forwarded-for, independent of client-supplied x-forwarded-for.
        const address = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const permitted = await transact((root) => {
          const byAddress = throttle(root, `ip:${address}`, 30, 15 * 60000);
          const byIdentity = throttle(root, `${action}:${String(input.name || '').trim()}`, 10, 15 * 60000);
          return byAddress && byIdentity;
        });
        if (!permitted) fail(429, '요청 횟수가 많습니다. 15분 후 다시 시도해주세요.');
        if (action === 'login') {
          const result = await transact((root) => {
            const authenticated = login(root, input, env);
            const token = signSession(authenticated.id, authenticated.record, env.SESSION_SECRET);
            const actor = principal(root, readSession(token, env.SESSION_SECRET), env);
            return { token, ...snapshot(root, actor) };
          });
          const { token, ...payload } = result;
          res.setHeader('Set-Cookie', cookie(token));
          return res.status(200).json(payload);
        }
        return res.status(200).json(await transact((root) => publicAction(root, action, input)));
      }
      const rawCookie = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`));
      const session = readSession(rawCookie?.slice(cookieName.length + 1), env.SESSION_SECRET);
      if (!session) fail(401, '로그인이 필요합니다.');
      if (action === 'state') {
        const root = await load();
        return res.status(200).json(snapshot(root, principal(root, session, env)));
      }
      const result = await transact((root) => mutate(root, principal(root, session, env), action, input, env));
      const { credential, ...payload } = result;
      if (['updateProfile', 'updateAdminPassword'].includes(action)) res.setHeader('Set-Cookie', cookie(signSession(session.id, credential, env.SESSION_SECRET)));
      return res.status(200).json(payload);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      // Never log credentials, Firebase response bodies, or request payloads.
      return res.status(status).json({ error: status < 500 || status === 503 ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }
  };
}
export default createHandler();
