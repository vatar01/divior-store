// Telegram-бот администратора Divior (webhook).
// Первый запуск: откройте в браузере  <адрес сайта>/.netlify/functions/tgbot?setup=1
import { SITE, esc, money, tg, admins, botToken, webhookSecret, hasServiceAccount,
  fsGet, fsPatch, fsAdd, fsQuery, setOrderStatus, STATUS, STATUS_ICON, orderText, orderKeyboard } from '../lib/core.mjs';

const HELP = `<b>Бот магазина Divior</b>\n\n/new — новые заказы\n/orders — последние 10 заказов\n/chats — непрочитанные чаты с сайта\n/stats — продажи за сегодня\n\nЧтобы ответить покупателю из чата сайта, нажмите «Ответить» на его сообщении.`;
const reply = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

async function setup() {
  if (!botToken()) return { ok: false, error: 'Не задан TELEGRAM_BOT_TOKEN' };
  const hook = await tg('setWebhook', { url: SITE + '/.netlify/functions/tgbot', secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'] });
  await tg('setMyCommands', { commands: [
    { command: 'new', description: 'Новые заказы' }, { command: 'orders', description: 'Последние заказы' },
    { command: 'chats', description: 'Непрочитанные чаты' }, { command: 'stats', description: 'Продажи за сегодня' }, { command: 'help', description: 'Помощь' }] });
  return { webhook: hook, admins: admins().length, firebase: hasServiceAccount() };
}

async function onCallback(cq) {
  const chatId = cq.message?.chat?.id;
  if (!admins().includes(String(cq.from.id))) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Нет доступа' });
  const [kind, id, st] = String(cq.data || '').split(':');
  if (kind !== 'st' || !STATUS[st]) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  try {
    const o = await setOrderStatus(id, st);
    await tg('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: orderText(o, id), parse_mode: 'HTML', reply_markup: orderKeyboard(id, st, o.customer?.phone) });
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Статус: ${STATUS[st]}` });
  } catch (e) {
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ошибка: ' + e.message.slice(0, 150), show_alert: true });
  }
}

async function onMessage(m) {
  const chatId = m.chat.id, text = String(m.text || '').trim();
  if (!admins().includes(String(m.from.id))) {
    return reply(chatId, `Здравствуйте! Это служебный бот магазина Divior.\nКаталог и заказы: ${SITE}\nПоддержка: https://wa.me/77753614090\n\nВаш ID: <code>${m.from.id}</code>`);
  }
  // Ответ покупателю в чат сайта
  const src = m.reply_to_message?.text || '';
  const cid = (src.match(/#c([a-z0-9]{12,40})/) || [])[1];
  if (cid && text && !text.startsWith('/')) {
    try {
      const at = Date.now();
      await fsAdd(`chats/${cid}/msgs`, { from: 'admin', text: text.slice(0, 1500), at });
      await fsPatch('chats/' + cid, { last: text.slice(0, 140), lastFrom: 'admin', at, unread: false });
      return reply(chatId, '✅ Ответ отправлен покупателю на сайт.');
    } catch (e) { return reply(chatId, '❌ Не удалось отправить: ' + esc(e.message)); }
  }
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  try {
    if (cmd === '/new' || cmd === '/orders') {
      const list = cmd === '/new' ? [...await fsQuery('orders', { where: ['status', 'new'], limit: 20 }), ...await fsQuery('orders', { where: ['status', 'wait'], limit: 20 })] : await fsQuery('orders', { orderBy: 'at', limit: 10 });
      list.sort((a, b) => (b.at || 0) - (a.at || 0));
      if (!list.length) return reply(chatId, cmd === '/new' ? 'Новых заказов нет 👍' : 'Заказов пока нет.');
      for (const o of list.slice(0, 10)) await reply(chatId, orderText(o, o.id), { reply_markup: orderKeyboard(o.id, o.status, o.customer?.phone) });
      return;
    }
    if (cmd === '/chats') {
      const list = (await fsQuery('chats', { where: ['unread', true], limit: 20 })).sort((a, b) => (b.at || 0) - (a.at || 0));
      if (!list.length) return reply(chatId, 'Непрочитанных чатов нет 👍');
      for (const c of list) await reply(chatId, `💬 <b>${esc(c.name || 'Покупатель')}</b>${c.phone ? ', ' + esc(c.phone) : ''}\n\n${esc(c.last || '')}\n\n<i>Нажмите «Ответить», чтобы написать покупателю.</i>\n#c${c.id}`);
      return;
    }
    if (cmd === '/stats') {
      const list = await fsQuery('orders', { orderBy: 'at', limit: 200 });
      const start = new Date(); start.setUTCHours(start.getUTCHours() + 5); start.setUTCHours(0, 0, 0, 0); // полночь по Казахстану (UTC+5)
      const from = start.getTime() - 5 * 3600000;
      const today = list.filter(o => o.at >= from && o.status !== 'cancel');
      const by = Object.keys(STATUS).map(k => `${STATUS_ICON[k]} ${STATUS[k]}: ${list.filter(o => o.at >= from && o.status === k).length}`).join('\n');
      return reply(chatId, `📊 <b>Сегодня</b>\n\nЗаказов: ${today.length}\nНа сумму: ${money(today.reduce((s, o) => s + Number(o.total || 0), 0))}\n\n${by}`);
    }
    return reply(chatId, HELP);
  } catch (e) {
    return reply(chatId, '❌ ' + esc(e.message) + (hasServiceAccount() ? '' : '\n\nДобавьте в Netlify ключ Firebase (FIREBASE_CLIENT_EMAIL и FIREBASE_PRIVATE_KEY).'));
  }
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('setup')) return Response.json(await setup());
    return new Response('Divior bot: ok');
  }
  if (req.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret()) return new Response('forbidden', { status: 403 });
  const u = await req.json().catch(() => ({}));
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) { console.error(e); }
  return new Response('ok');
};
