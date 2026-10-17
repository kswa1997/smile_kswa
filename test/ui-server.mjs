// Local UI verification only. Never uses the production database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHandler } from '../api/app.js';
import { hashPassword } from '../server/security.js';
const base = resolve('dist');
let root = { members: { a: { id: 'a', name: '검증회원', affiliation: '검증학회', phone: '01012345678', role: 'member', passwordHash: hashPassword('test1234') } }, mileageRecords: { a: { id: 'a', memberId: 'a', memberName: '검증회원', type: 'earn', amount: 300000, createdAt: new Date().toISOString() } } };
const handler = createHandler({ env: { SESSION_SECRET: 'local-ui-test-only-secret-with-at-least-32-bytes', APP_ORIGIN: 'http://127.0.0.1:5178' }, load: async () => structuredClone(root), transact: async (change) => { const next = structuredClone(root); const result = await change(next); root = next; return result; } });
createServer(async (req, res) => {
  if (req.url === '/api/app') {
    let input = ''; for await (const chunk of req) input += chunk;
    req.body = input;
    res.status = (status) => { res.statusCode = status; return res; };
    res.json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    return handler(req, res);
  }
  const path = resolve(base, '.' + new URL(req.url, 'http://localhost').pathname);
  if (path !== base && !path.startsWith(base + sep)) { res.writeHead(403); return res.end(); }
  try {
    const target = path === base ? resolve(base, 'index.html') : path;
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end(); }
}).listen(5178, '127.0.0.1', () => process.stdout.write('Local security UI fixture: http://127.0.0.1:5178\n'));
