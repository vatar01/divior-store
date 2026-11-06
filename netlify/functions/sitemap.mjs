// Карта сайта для Яндекса и Google: главная + все товары, которые показываются в магазине.
import { catalog, SITE } from '../lib/core.mjs';
export const config = { path: '/sitemap.xml' };

export default async () => {
  const base = (process.env.URL || SITE).replace(/\/$/, '');
  const { map } = await catalog();
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  for (const p of Object.values(map)) {
    if (p.active === false) continue;
    const img = p.kimg && p.kimg.length ? `<image:image><image:loc>${x('https://resources.cdn-kaspi.kz/img/m/p/' + p.kimg[0] + '?format=gallery-large')}</image:loc></image:image>` : '';
    urls.push(`<url><loc>${x(base + '/product/' + encodeURIComponent(p.id))}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>${img}</url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Netlify-CDN-Cache-Control': 'public, s-maxage=3600' } });
};
