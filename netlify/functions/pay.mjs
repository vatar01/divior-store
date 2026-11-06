// GET  — включена ли онлайн-оплата картой (сайт показывает способ оплаты, только если да).
// POST {idToken, orderId} — получить ссылку на оплату своего заказа (повторная попытка из «Моих заказов»).
import { verifyUser, fsGet, fsPatch } from '../lib/core.mjs';
import { fpEnabled, fpInit } from '../lib/freedom.mjs';

export default async (req) => {
  if (req.method === 'GET') return Response.json({ enabled: fpEnabled() }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  if (!fpEnabled()) return Response.json({ ok: false, error: 'Онлайн-оплата пока не подключена' }, { status: 503 });
  let b; try { b = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const u = await verifyUser(b.idToken);
  if (!u) return Response.json({ ok: false, error: 'Войдите в аккаунт заново' }, { status: 401 });
  if (!/^[A-Za-z0-9]{10,40}$/.test(b.orderId || '')) return Response.json({ ok: false, error: 'bad' }, { status: 400 });
  const o = await fsGet('orders/' + b.orderId).catch(() => null);
  if (!o || o.uid !== u.uid) return Response.json({ ok: false, error: 'Заказ не найден' }, { status: 404 });
  if (o.status !== 'wait' && o.status !== 'new') return Response.json({ ok: false, error: 'Этот заказ уже оплачен или закрыт' }, { status: 409 });
  try {
    const p = await fpInit(o, b.orderId);
    await fsPatch('orders/' + b.orderId, { payId: p.paymentId, pay: 'online', payName: 'Картой онлайн', status: 'wait' });
    return Response.json({ ok: true, url: p.url });
  } catch (e) { return Response.json({ ok: false, error: e.message }, { status: 502 }); }
};
