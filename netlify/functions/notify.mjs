// Отправляет уведомления в Telegram владельцу магазина.
// Токен бота и ID чата хранятся в переменных окружения Netlify (не в коде сайта):
//   TELEGRAM_BOT_TOKEN — токен от @BotFather
//   TELEGRAM_CHAT_ID   — ваш ID (узнать у @userinfobot)
const PROJECT = 'divior-store';
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const money = n => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₸';

function fromFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  return null;
}

async function send(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, reason: 'not-configured' };
  const ids = String(chat).split(',').map(s => s.trim()).filter(Boolean);
  for (const id of ids) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  }
  return { ok: true };
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Divior notify: ok');
  let body;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  if (body.type === 'order') {
    // Проверяем, что заказ действительно есть в базе: читаем его токеном покупателя.
    if (!/^[A-Za-z0-9]{10,40}$/.test(body.orderId || '') || !body.idToken) return new Response('bad', { status: 400 });
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/orders/${body.orderId}`,
      { headers: { Authorization: 'Bearer ' + body.idToken } });
    if (!r.ok) return new Response('order not found', { status: 403 });
    const o = fromFs({ mapValue: { fields: (await r.json()).fields } });
    if (Date.now() - Number(o.at || 0) > 10 * 60 * 1000) return new Response('too old', { status: 403 });
    const items = (o.items || []).map(i => `• ${esc(i.name)} × ${i.q} — ${money(i.price * i.q)}`).join('\n');
    const text = `🛍 <b>Новый заказ ${esc(o.num)}</b>\n\n` +
      `<b>Сумма:</b> ${money(o.total)}${o.shipTbd ? ' + доставка' : ''}\n` +
      `<b>Покупатель:</b> ${esc(o.customer?.name)}, ${esc(o.customer?.phone)}\n` +
      `<b>Получение:</b> ${esc(o.shipName)}${o.address ? '\n' + esc(o.address) : ''}\n` +
      `<b>Оплата:</b> ${esc(o.payName)}\n\n${items}` +
      (o.comment ? `\n\n💬 ${esc(o.comment)}` : '');
    return Response.json(await send(text));
  }

  if (body.type === 'support') {
    const name = String(body.name || '').slice(0, 80), phone = String(body.phone || '').slice(0, 40), text = String(body.text || '').slice(0, 1500);
    if (body.website || text.trim().length < 3) return new Response('ignored'); // ловушка для ботов
    return Response.json(await send(`💬 <b>Вопрос с сайта</b>\n\n<b>Имя:</b> ${esc(name || '—')}\n<b>Телефон:</b> ${esc(phone || '—')}\n\n${esc(text)}`));
  }

  if (body.type === 'test') {
    return Response.json(await send('✅ Уведомления с сайта Divior работают.'));
  }
  return new Response('unknown', { status: 400 });
};
