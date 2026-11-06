// Уведомление от Freedom Pay о результате оплаты (сервер → сервер). Подпись проверяется секретным ключом,
// поэтому отметить заказ оплаченным может только сам Freedom Pay.
import { fsGet, fsPatch, sendAdmins, esc, money, orderKeyboard, setOrderStatus } from '../lib/core.mjs';
import { fpEnabled, fpCheck, fpReply } from '../lib/freedom.mjs';
const SCRIPT = 'payresult';

export default async (req) => {
  if (!fpEnabled()) return new Response('not configured', { status: 503 });
  let params = {};
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) { for (const [k, v] of (await req.formData()).entries()) params[k] = String(v); }
    else params = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? new URL(req.url).search : await req.text()));
  } catch { return new Response('bad', { status: 400 }); }

  if (!fpCheck(SCRIPT, params)) return fpReply(SCRIPT, 'error', 'Invalid signature');
  const id = String(params.pg_order_id || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return fpReply(SCRIPT, 'error', 'Unknown order');
  const o = await fsGet('orders/' + id).catch(() => null);
  if (!o) return fpReply(SCRIPT, 'error', 'Order not found');

  if (String(params.pg_result) === '1') {
    if (Math.round(Number(params.pg_amount)) < Math.round(Number(o.total))) return fpReply(SCRIPT, 'error', 'Amount mismatch');
    if (o.status !== 'paid' && o.status !== 'ship' && o.status !== 'done') {
      // если заказ успели отменить — возвращаем его в работу и снова списываем остаток
      if (o.status === 'cancel') await setOrderStatus(id, 'paid');
      await fsPatch('orders/' + id, { status: 'paid', paidAt: Date.now(), payId: String(params.pg_payment_id || ''), payCard: String(params.pg_card_pan || '') });
      await sendAdmins(`💳 <b>Заказ ${esc(o.num)} оплачен онлайн</b>\n${money(o.total)}${params.pg_card_pan ? ' · карта ' + esc(params.pg_card_pan) : ''}\n${esc(o.customer?.name)}, ${esc(o.customer?.phone)}`,
        { reply_markup: orderKeyboard(id, 'paid', o.customer?.phone) }).catch(() => { });
    }
    return fpReply(SCRIPT, 'ok', 'Order paid');
  }
  // Неудачная попытка оплаты: заказ остаётся «Ждёт оплаты», покупатель может попробовать ещё раз.
  await fsPatch('orders/' + id, { payError: String(params.pg_failure_description || 'Оплата не прошла').slice(0, 200) }).catch(() => { });
  return fpReply(SCRIPT, 'ok', 'Failure noted');
};
