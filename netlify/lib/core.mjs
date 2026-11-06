// Общий код для функций Netlify: Telegram и Firestore (через сервисный аккаунт Firebase).
// Переменные окружения Netlify:
//   TELEGRAM_BOT_TOKEN     — токен бота от @BotFather
//   TELEGRAM_CHAT_ID       — ID администраторов через запятую (узнать у @userinfobot)
//   FIREBASE_CLIENT_EMAIL  — client_email из ключа сервисного аккаунта
//   FIREBASE_PRIVATE_KEY   — private_key из того же ключа
import crypto from 'node:crypto';

export const PROJECT = 'divior-store';
export const SITE = (process.env.URL || 'https://splendid-pothos-40c027.netlify.app').replace(/\/$/, '');
export const API_KEY = 'AIzaSyBQBvoYIJoPgVj6LIoODUX-LlkLs0QUnDs'; // публичный ключ веб-приложения Firebase (не секрет)
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const money = n => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₸';
export const admins = () => String(process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
export const botToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
export const webhookSecret = () => crypto.createHash('sha256').update('divior:' + botToken()).digest('hex').slice(0, 40);

export async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.json().catch(() => ({}));
}
export async function sendAdmins(text, extra = {}) {
  if (!botToken() || !admins().length) return { ok: false, reason: 'not-configured' };
  for (const id of admins()) await tg('sendMessage', { chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  return { ok: true };
}

// ---------- Firestore REST ----------
export function fromFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  return null;
}
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
}
const docOut = d => d && d.fields ? { id: d.name.split('/').pop(), ...fromFs({ mapValue: { fields: d.fields } }) } : null;

let cached = { token: null, exp: 0 };
export const hasServiceAccount = () => !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const email = process.env.FIREBASE_CLIENT_EMAIL, key = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Нет ключа сервисного аккаунта Firebase в Netlify');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Firebase не выдал доступ: ' + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}
async function fs(path, opts = {}) {
  const r = await fetch(FS + path, { ...opts, headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('Firestore ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}
export const fsGet = async p => docOut(await fs('/' + p));
export async function fsPatch(p, data) {
  const mask = Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return docOut(await fs('/' + p + '?' + mask, { method: 'PATCH', body: JSON.stringify({ fields: toFs(data).mapValue.fields }) }));
}
export const fsAdd = async (col, data) => docOut(await fs('/' + col, { method: 'POST', body: JSON.stringify({ fields: toFs(data).mapValue.fields }) }));
export async function fsQuery(collectionId, { where, orderBy, desc = true, limit = 10 } = {}) {
  const q = { from: [{ collectionId }], limit };
  if (where) q.where = { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: toFs(where[1]) } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy }, direction: desc ? 'DESCENDING' : 'ASCENDING' }];
  const res = await fs(':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: q }) });
  return res.filter(x => x.document).map(x => docOut(x.document));
}

// Пакетная запись (атомарно): создание заказа + списание остатков одним запросом.
export const DOC = p => `projects/${PROJECT}/databases/(default)/documents/${p}`;
export const fsCommit = writes => fs(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
// Все документы коллекции (для каталога: catalog/c0, c1…).
export async function fsList(col, { auth = true } = {}) {
  let out = [], page = '';
  do {
    const url = `/${col}?pageSize=100${page ? '&pageToken=' + page : ''}`;
    const j = auth ? await fs(url) : await (await fetch(FS + url)).json();
    out = out.concat((j.documents || []).map(docOut)); page = j.nextPageToken || '';
  } while (page);
  return out;
}
// Каталог одним объектом {id: товар}, с кэшем на минуту (читается без ключа — каталог публичный).
let catCache = { at: 0, map: null, chunk: null };
export async function catalog(fresh = false) {
  if (!fresh && catCache.map && Date.now() - catCache.at < 60000) return catCache;
  const docs = await fsList('catalog', { auth: false });
  const map = {}, chunk = {};
  for (const d of docs) for (const [id, p] of Object.entries(d.items || {})) { map[id] = { id, ...p }; chunk[id] = d.id; }
  catCache = { at: Date.now(), map, chunk };
  return catCache;
}
// Проверка входа покупателя: Google сам проверяет токен и возвращает пользователя.
export async function verifyUser(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4000) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  const j = await r.json().catch(() => ({}));
  const u = j.users && j.users[0];
  return u ? { uid: u.localId, email: u.email || '', emailVerified: !!u.emailVerified, disabled: !!u.disabled } : null;
}
// Ограничение частоты: не больше max событий за windowMs по ключу (IP, пользователь, чат).
export async function rateLimit(key, max, windowMs) {
  const id = 'rl_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  const now = Date.now();
  let d = null; try { d = await fsGet('limits/' + id); } catch { }
  const hits = (d?.hits || []).filter(t => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  await fsPatch('limits/' + id, { hits, until: now + windowMs }).catch(() => { });
  return true;
}
export const clientIp = req => (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

// ---------- Заказы ----------
export const STATUS = { new: 'Новый', wait: 'Ждёт оплаты', paid: 'Оплачен', ship: 'В доставке', done: 'Выполнен', cancel: 'Отменён' };
export const STATUS_ICON = { new: '🆕', wait: '⏳', paid: '💳', ship: '🚚', done: '✅', cancel: '❌' };
export function orderText(o, id) {
  const items = (o.items || []).map(i => `• ${esc(i.name)} × ${i.q} — ${money(i.price * i.q)}`).join('\n');
  return `🛍 <b>Заказ ${esc(o.num || id)}</b>  ${STATUS_ICON[o.status] || ''} ${STATUS[o.status] || ''}\n\n` +
    `<b>Сумма:</b> ${money(o.total)}${o.shipTbd ? ' + доставка' : ''}\n` +
    `<b>Покупатель:</b> ${esc(o.customer?.name)}, ${esc(o.customer?.phone)}\n` +
    `<b>Получение:</b> ${esc(o.shipName)}${o.address ? '\n' + esc(o.address) : ''}\n` +
    `<b>Оплата:</b> ${esc(o.payName)}\n\n${items}` + (o.comment ? `\n\n💬 ${esc(o.comment)}` : '');
}
export function orderKeyboard(id, status, phone) {
  const b = (st, label) => ({ text: (status === st ? '• ' : '') + label, callback_data: `st:${id}:${st}` });
  const rows = [[b('wait', '⏳ Ждёт оплаты'), b('paid', '💳 Оплачен')], [b('ship', '🚚 В доставке'), b('done', '✅ Выполнен')], [b('cancel', '❌ Отменить')]];
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length >= 10) rows.push([{ text: '💬 Написать в WhatsApp', url: 'https://wa.me/' + p }]);
  return { inline_keyboard: rows };
}

// Смена статуса заказа. При отмене товар возвращается на остаток, при «отмене отмены» — снова списывается.
export async function setOrderStatus(id, st) {
  const o = await fsGet('orders/' + id);
  if (!o) throw new Error('Заказ не найден');
  const back = st === 'cancel' && o.stockTaken && !o.restocked;
  const again = st !== 'cancel' && o.restocked;
  const writes = [{ update: { name: DOC('orders/' + id), fields: toFs({ status: st, restocked: back ? true : again ? false : !!o.restocked }).mapValue.fields }, updateMask: { fieldPaths: ['status', 'restocked'] } }];
  if (back || again) {
    const { map, chunk } = await catalog(true), per = {};
    for (const i of o.items || []) { const p = map[i.pid]; if (p && p.stock != null) (per[chunk[i.pid]] = per[chunk[i.pid]] || []).push(i); }
    for (const [c, list] of Object.entries(per)) writes.push({ transform: { document: DOC('catalog/' + c),
      fieldTransforms: list.map(i => ({ fieldPath: 'items.`' + i.pid + '`.stock', increment: { integerValue: String(back ? i.q : -i.q) } })) } });
  }
  await fsCommit(writes);
  return { ...o, status: st };
}
