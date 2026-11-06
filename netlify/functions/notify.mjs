// Уведомления с сайта в Telegram-бот администратора.
import { PROJECT, esc, sendAdmins, orderText, orderKeyboard } from '../lib/core.mjs';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
import { fromFs } from '../lib/core.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Divior notify: ok');
  let body; try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  if (body.type === 'order') {
    // Заказ проверяем, читая его токеном самого покупателя: подделать уведомление нельзя.
    if (!/^[A-Za-z0-9]{10,40}$/.test(body.orderId || '') || !body.idToken) return new Response('bad', { status: 400 });
    const r = await fetch(`${FS}/orders/${body.orderId}`, { headers: { Authorization: 'Bearer ' + body.idToken } });
    if (!r.ok) return new Response('order not found', { status: 403 });
    const o = fromFs({ mapValue: { fields: (await r.json()).fields } });
    if (Date.now() - Number(o.at || 0) > 10 * 60 * 1000) return new Response('too old', { status: 403 });
    return Response.json(await sendAdmins(orderText(o, body.orderId), { reply_markup: orderKeyboard(body.orderId, o.status, o.customer?.phone) }));
  }

  if (body.type === 'chat') {
    if (!/^[a-z0-9]{12,40}$/.test(body.cid || '')) return new Response('bad', { status: 400 });
    const r = await fetch(`${FS}/chats/${body.cid}`);
    if (!r.ok) return new Response('chat not found', { status: 403 });
    const name = String(body.name || '').slice(0, 80), phone = String(body.phone || '').slice(0, 40), text = String(body.text || '').slice(0, 1500);
    return Response.json(await sendAdmins(
      `💬 <b>${esc(name || 'Покупатель')}</b>${phone ? ', ' + esc(phone) : ''}\n\n${esc(text)}\n\n<i>Ответьте на это сообщение (свайп или «Ответить») — покупатель увидит ответ в чате на сайте.</i>\n#c${body.cid}`));
  }

  if (body.type === 'test') return Response.json(await sendAdmins('✅ Уведомления с сайта Divior работают.'));
  return new Response('unknown', { status: 400 });
};
