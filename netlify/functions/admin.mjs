// Действия администратора, которые должен выполнять сервер (смена статуса заказа с возвратом остатков).
import { verifyUser, setOrderStatus, STATUS, hasServiceAccount } from '../lib/core.mjs';
const ADMIN = 'ryabovdima112@gmail.com';

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!hasServiceAccount()) return Response.json({ ok: false, error: 'Нет ключа Firebase в Netlify' }, { status: 500 });
  let b; try { b = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const u = await verifyUser(b.idToken);
  if (!u || !u.emailVerified || u.email.toLowerCase() !== ADMIN) return Response.json({ ok: false, error: 'Нет доступа' }, { status: 403 });
  if (b.action === 'status') {
    if (!/^[A-Za-z0-9]{10,40}$/.test(b.id || '') || !STATUS[b.st]) return Response.json({ ok: false, error: 'bad' }, { status: 400 });
    try { await setOrderStatus(b.id, b.st); return Response.json({ ok: true }); }
    catch (e) { return Response.json({ ok: false, error: e.message }, { status: 500 }); }
  }
  return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
};
