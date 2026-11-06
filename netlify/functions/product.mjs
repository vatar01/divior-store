// Страница товара /product/ID для поисковиков и ссылок в мессенджерах.
// Берём обычную главную страницу и вставляем в неё заголовок, описание, картинку, цену и характеристики товара.
// Покупатель видит то же самое, а скрипт сайта затем «оживляет» страницу (корзина, вкладки, похожие товары).
import { catalog, PROJECT, SITE } from '../lib/core.mjs';

export const config = { path: '/product/*' };

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₸';
const KCDN = 'https://resources.cdn-kaspi.kz/img/m/p/';
const CATS = { sets: 'Сервизы и наборы', plates: 'Тарелки', cups: 'Чашки и кружки', bowls: 'Салатники и пиалы', teapots: 'Чайники', glass: 'Бокалы и стаканы', cutlery: 'Столовые приборы', serving: 'Сервировка', cookware: 'Посуда для готовки', kitchen: 'Для кухни', appliances: 'Техника', light: 'Светотехника', decor: 'Декор и статуэтки', other: 'Разное' };
const val = v => String(v).replace(/\btrue\b/gi, 'Да').replace(/\bfalse\b/gi, 'Нет');

let shell = { at: 0, html: '' };
async function getShell(origin) {
  if (shell.html && Date.now() - shell.at < 120000) return shell.html;
  const r = await fetch(origin + '/index.html');
  shell = { at: Date.now(), html: await r.text() };
  return shell.html;
}
async function getSpecs(id) {
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/specs/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const f = (await r.json()).fields || {};
    const groups = (f.s?.arrayValue?.values || []).map(g => {
      const m = g.mapValue?.fields || {};
      if (g.arrayValue) return null;
      return [m.g?.stringValue || '', (m.f?.arrayValue?.values || []).map(x => { const y = x.mapValue?.fields || {}; return [y.k?.stringValue || '', Object.values(y.v || {})[0]]; })];
    }).filter(Boolean);
    return { groups, d: f.d?.stringValue || '' };
  } catch { return null; }
}

export default async (req) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const id = decodeURIComponent(url.pathname.split('/')[2] || '');
  let html = await getShell(origin);
  const base = (process.env.URL || SITE).replace(/\/$/, '');
  const canon = base + '/product/' + encodeURIComponent(id);

  let p = null;
  try { p = (await catalog()).map[id]; } catch { }
  if (!p || p.active === false) {
    html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex">');
    return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const sp = await getSpecs(id);
  const desc = String(p.desc || sp?.d || '').trim();
  const cat = CATS[p.cat] || 'Посуда';
  const img = p.kimg && p.kimg.length ? KCDN + p.kimg[0] + '?format=gallery-large' : (p.photoUrl || '');
  const inStock = !(p.stock != null && Number(p.stock) <= 0);
  const metaDesc = (desc ? desc.replace(/\s+/g, ' ').slice(0, 150) + (desc.length > 150 ? '…' : '') + ' ' : '') +
    `Цена ${money(p.price)}. ${cat} в магазине Divior, Павлодар. Доставка по Казахстану.`;
  const title = `${p.name} — купить в Павлодаре за ${money(p.price)} | Divior`;

  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku || id, category: cat,
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(img ? { image: [img] } : {}), ...(desc ? { description: desc.slice(0, 5000) } : {}),
    offers: { '@type': 'Offer', url: canon, priceCurrency: 'KZT', price: Math.round(Number(p.price) || 0),
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'Divior' } }
  };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: base + '/' },
    { '@type': 'ListItem', position: 2, name: cat, item: base + '/#catalog' },
    { '@type': 'ListItem', position: 3, name: p.name, item: canon }] };
  const json = o => JSON.stringify(o).replace(/</g, '\\u003c');

  const head = `<title>${h(title)}</title>
<meta name="description" content="${h(metaDesc)}">
<link rel="canonical" href="${h(canon)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Divior">
<meta property="og:title" content="${h(p.name)} — ${h(money(p.price))}">
<meta property="og:description" content="${h(metaDesc)}">
<meta property="og:url" content="${h(canon)}">
${img ? `<meta property="og:image" content="${h(img)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<script type="application/ld+json">${json(ld)}</script>
<script type="application/ld+json">${json(crumbs)}</script>`;
  // убираем мета-теги главной и ставим товарные
  html = html.replace(/<meta (name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\n?/g, '')
    .replace(/<link rel="canonical"[^>]*>\n?/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => head);

  const specs = (sp?.groups || []).map(([g, f]) => `<h4>${h(g)}</h4><dl>${f.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(val(v))}</dd>`).join('')}</dl>`).join('');
  const body = `<section class="block pd-page" id="pdPage" aria-label="Товар"><div class="wrap">
<nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a> / <a href="/#catalog">${h(cat)}</a> / <span>${h(p.name)}</span></nav>
<div class="pd-wrap"><div class="pd"><div><div class="media pd-main">${img ? `<img src="${h(img)}" alt="${h(p.name)}" referrerpolicy="no-referrer">` : ''}</div></div><div>
<span class="eyebrow">${h(cat)}${p.brand ? ' · ' + h(p.brand) : ''}</span>
<h1 class="pd-h1">${h(p.name)}</h1>
<div style="font-size:30px;font-weight:700;margin:10px 0" class="price">${h(money(p.price))}</div>
<dl style="margin:6px 0 18px"><dt>Наличие</dt><dd>${inStock ? 'В наличии' : 'Нет в наличии'}</dd><dt>Самовывоз</dt><dd>ТД «Артур», бутик 1‑204</dd></dl>
</div></div>
${desc ? `<h2 class="sim-h">Описание</h2><div class="desc-text">${h(desc)}</div>` : ''}
${specs ? `<h2 class="sim-h">Характеристики</h2><div class="specs">${specs}</div>` : ''}
</div></div></section>`;
  html = html.replace(/<section class="block pd-page" id="pdPage"[^>]*><\/section>/, () => body).replace('<body>', '<body class="on-product">');

  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400'
  } });
};
