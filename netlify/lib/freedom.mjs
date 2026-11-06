// Онлайн-оплата картой через Freedom Pay (Казахстан). Документация: https://docs.freedompay.kz
// Переменные окружения Netlify (выдаёт Freedom Pay после заключения договора):
//   FREEDOM_MERCHANT_ID — ID магазина
//   FREEDOM_SECRET_KEY  — секретный ключ для приёма платежей («ключ для приёма платежей» в кабинете)
//   FREEDOM_TEST=1      — тестовый режим (необязательно; новые магазины и так сначала в тестовом режиме)
import crypto from 'node:crypto';
import { SITE } from './core.mjs';

export const FP_API = 'https://api.freedompay.kz';
export const fpEnabled = () => !!(process.env.FREEDOM_MERCHANT_ID && process.env.FREEDOM_SECRET_KEY);
const secret = () => process.env.FREEDOM_SECRET_KEY || '';

// Подпись: имя скрипта; значения всех полей по алфавиту ключей; секретный ключ → md5.
export function fpSign(script, params) {
  const vals = Object.keys(params).filter(k => k !== 'pg_sig').sort().map(k => String(params[k] ?? ''));
  return crypto.createHash('md5').update([script, ...vals, secret()].join(';')).digest('hex');
}
export const fpCheck = (script, params) => {
  if (!params.pg_sig) return false;
  const a = Buffer.from(fpSign(script, params)), b = Buffer.from(String(params.pg_sig).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const tag = (xml, name) => (String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() || '';
const salt = () => crypto.randomBytes(8).toString('hex');

// Создаёт платёж и возвращает ссылку на страницу оплаты Freedom Pay.
export async function fpInit(order, id) {
  const base = (process.env.URL || SITE).replace(/\/$/, '');
  const phone = String(order.customer?.phone || '').replace(/\D/g, '');
  const p = {
    pg_merchant_id: process.env.FREEDOM_MERCHANT_ID,
    pg_order_id: id,
    pg_amount: String(Math.round(order.total)),
    pg_currency: 'KZT',
    pg_description: `Заказ ${order.num} в магазине Divior`,
    pg_salt: salt(),
    pg_result_url: base + '/.netlify/functions/payresult',
    pg_request_method: 'POST',
    pg_success_url: base + '/?paid=' + encodeURIComponent(order.num),
    pg_failure_url: base + '/?payfail=' + encodeURIComponent(id),
    pg_success_url_method: 'GET',
    pg_failure_url_method: 'GET',
    pg_site_url: base + '/',
    pg_lifetime: '86400',
    pg_language: 'ru',
    ...(phone.length >= 10 ? { pg_user_phone: phone } : {}),
    ...(order.customer?.email ? { pg_user_contact_email: order.customer.email } : {}),
    ...(process.env.FREEDOM_TEST === '1' ? { pg_testing_mode: '1' } : {})
  };
  p.pg_sig = fpSign('init_payment.php', p);
  const r = await fetch(FP_API + '/init_payment.php', { method: 'POST', body: new URLSearchParams(p) });
  const xml = await r.text();
  if (tag(xml, 'pg_status') !== 'ok') throw new Error('Freedom Pay: ' + (tag(xml, 'pg_error_description') || tag(xml, 'pg_description') || 'ошибка ' + r.status));
  return { url: tag(xml, 'pg_redirect_url'), paymentId: tag(xml, 'pg_payment_id') };
}

// Ответ на уведомление Freedom Pay (XML с подписью).
export function fpReply(script, status, description) {
  const p = { pg_status: status, pg_description: description, pg_salt: salt() };
  p.pg_sig = fpSign(script, p);
  return new Response(`<?xml version="1.0" encoding="utf-8"?>\n<response><pg_status>${p.pg_status}</pg_status><pg_description>${p.pg_description}</pg_description><pg_salt>${p.pg_salt}</pg_salt><pg_sig>${p.pg_sig}</pg_sig></response>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
