// Оформление заказа на сервере.
// Покупатель присылает только «какие товары и сколько»; цены, наличие и сумму считает сервер по каталогу,
// поэтому подделать сумму в браузере нельзя. Здесь же защита от ботов и списание остатков.
import crypto from 'node:crypto';
import { fpEnabled, fpInit } from '../lib/freedom.mjs';
import {
  esc, catalog, verifyUser, rateLimit, clientIp, fsGet, fsPatch, fsCommit, DOC, toFs,
  sendAdmins, orderText, orderKeyboard, hasServiceAccount
} from '../lib/core.mjs';

const SHIP = {
  courier: { name: 'Курьером по Павлодару', cost: null },
  pickup: { name: 'Самовывоз из бутика', cost: 0 },
  kz: { name: 'По Казахстану', cost: null }
};
const PAY = {
  online: 'Картой онлайн',
  kaspi: 'Kaspi: счёт на ваш номер',
  qr: 'По QR-коду',
  card: 'Картой при получении',
  bank: 'Переводом через банк',
  cash: 'Наличными'
};
const bad = (msg, status = 400) => Response.json({ ok: false, error: msg }, { status });
const str = (v, n) => String(v ?? '').trim().slice(0, n);

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  if (!hasServiceAccount()) return bad('Сервер не настроен (нет ключа Firebase в Netlify).', 500);
  let b; try { b = await req.json(); } catch { return bad('bad json'); }

  // 1. Ловушки для ботов: скрытое поле должно быть пустым, форму нельзя заполнить быстрее 3 секунд.
  if (b.hp) return bad('Не удалось оформить заказ.', 403);
  if (!(Number(b.elapsed) >= 3000)) return bad('Слишком быстро. Проверьте данные и нажмите ещё раз.', 429);

  // 2. Только вошедший покупатель (токен проверяет Google).
  const user = await verifyUser(b.idToken);
  if (!user || user.disabled) return bad('Войдите в аккаунт заново.', 401);

  // 3. Лимиты: с одного IP — 10 заказов в час, с одного аккаунта — 5 в час и 15 в сутки.
  const ip = clientIp(req);
  if (!await rateLimit('order-ip:' + ip, 10, 3600e3)) return bad('Слишком много заказов. Позвоните нам: +7 775 361-40-90.', 429);
  if (!await rateLimit('order-u:' + user.uid, 5, 3600e3) || !await rateLimit('order-ud:' + user.uid, 15, 86400e3))
    return bad('Слишком много заказов с этого аккаунта. Позвоните нам: +7 775 361-40-90.', 429);

  // 4. Проверяем состав по каталогу.
  const ship = SHIP[b.ship] ? b.ship : null, pay = PAY[b.pay] && (b.pay !== 'online' || fpEnabled()) ? b.pay : null;
  if (!ship || !pay) return bad('Выберите способ получения и оплаты.');
  const want = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
  if (!want.length) return bad('Корзина пуста.');
  const { map, chunk } = await catalog(true);
  const items = [], problems = [];
  const seen = new Set();
  for (const w of want) {
    const pid = str(w.pid, 80), q = Math.floor(Number(w.q));
    if (!pid || seen.has(pid) || !(q >= 1 && q <= 99)) continue;
    seen.add(pid);
    const p = map[pid];
    if (!p || p.active === false) { problems.push(`«${(p && p.name) || 'товар'}» больше не продаётся`); continue; }
    const stock = p.stock == null ? null : Number(p.stock);
    if (stock != null && stock < q) { problems.push(stock > 0 ? `«${p.name}»: в наличии только ${stock} шт` : `«${p.name}» закончился`); continue; }
    items.push({ pid, name: String(p.name), price: Math.round(Number(p.price) || 0), q, stock });
  }
  if (problems.length) return Response.json({ ok: false, error: 'Корзина изменилась: ' + problems.join('; ') + '.', refresh: true }, { status: 409 });
  if (!items.length) return bad('Корзина пуста.');

  // 5. Данные покупателя берём из его профиля в базе, а не из запроса.
  const prof = (await fsGet('users/' + user.uid).catch(() => null)) || {};
  const pr = prof.profile || {};
  if (!pr.name || !pr.phone) return bad('Заполните имя и телефон в профиле.');

  const address = ship === 'pickup' ? '' : str(b.address, 400);
  if (ship !== 'pickup' && address.length < 5) return bad('Укажите адрес доставки.');

  const sum = items.reduce((s, i) => s + i.price * i.q, 0);
  const shipCost = SHIP[ship].cost || 0;
  const id = crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  const order = {
    num: 'D-' + Date.now().toString(36).toUpperCase().slice(-6),
    at: Date.now(), status: pay === 'kaspi' || pay === 'online' ? 'wait' : 'new', uid: user.uid,
    customer: { name: str(pr.name, 80), phone: str(pr.phone, 30), email: user.email },
    items: items.map(({ stock, ...i }) => i),
    sum, shipCost, shipTbd: SHIP[ship].cost == null, total: sum + shipCost,
    ship, shipName: SHIP[ship].name, pay, payName: PAY[pay],
    address, region: ship === 'pickup' ? '' : str(b.region, 80), comment: str(b.comment, 600),
    stockTaken: true, src: 'site'
  };

  // 6. Одним атомарным запросом: создаём заказ и уменьшаем остатки.
  const perChunk = {};
  for (const i of items) if (i.stock != null) (perChunk[chunk[i.pid]] = perChunk[chunk[i.pid]] || []).push(i);
  const writes = [{ update: { name: DOC('orders/' + id), fields: toFs(order).mapValue.fields }, currentDocument: { exists: false } }];
  for (const [c, list] of Object.entries(perChunk)) writes.push({
    transform: {
      document: DOC('catalog/' + c),
      fieldTransforms: list.map(i => ({ fieldPath: 'items.`' + i.pid + '`.stock', increment: { integerValue: String(-i.q) } }))
    }
  });
  try { await fsCommit(writes); }
  catch (e) { console.error(e); return bad('Не удалось сохранить заказ. Попробуйте ещё раз.', 500); }

  await sendAdmins(orderText(order, id) + `\n\n<i>IP: ${esc(ip)}</i>`, { reply_markup: orderKeyboard(id, order.status, order.customer.phone) }).catch(() => { });
  let payUrl = '', payError = '';
  if (pay === 'online') {
    try { const r = await fpInit(order, id); payUrl = r.url; await fsPatch('orders/' + id, { payId: r.paymentId }).catch(() => { }); }
    catch (e) { console.error(e); payError = 'Заказ сохранён, но страница оплаты не открылась. Оплатите позже в «Моих заказах» или позвоните нам.'; }
  }
  return Response.json({ ok: true, id, payUrl, payError, num: order.num, total: order.total, shipTbd: order.shipTbd, payName: order.payName, status: order.status });
};
