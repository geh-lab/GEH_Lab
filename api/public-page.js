import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicDataCache, PUBLIC_CACHE_TTL_MS, PUBLIC_RETRY_MS } from '../server/public-data.mjs';

const sharedData = createPublicDataCache();
const renderServerPublicPage = async (...args) => (await import('../server/render-public-page.mjs')).renderServerPublicPage(...args);
export const PUBLIC_PAGES = Object.freeze({
  home: { file: 'index.html', collections: ['members', 'projects', 'publications', 'patents', 'boardPosts'] },
  members: { file: 'members.html', collections: ['members'] },
  projects: { file: 'projects.html', collections: ['projects', 'members'] },
  publications: { file: 'publications.html', collections: ['publications', 'members'] },
  patents: { file: 'patents.html', collections: ['patents', 'members'] },
  board: { file: 'news.html', collections: ['boardPosts'] }
});

function requestRoute(req) {
  let query;
  try { query = new URL(req.url || '/', 'https://local.invalid').searchParams; } catch { return null; }
  if (query.getAll('lang').length > 1 || query.getAll('page').length > 1) return null;
  const lang = req.query?.lang ?? query.get('lang') ?? 'kr';
  const page = req.query?.page ?? query.get('page') ?? 'home';
  if (!['kr', 'en'].includes(lang) || typeof page !== 'string' || !Object.hasOwn(PUBLIC_PAGES, page)) return null;
  return { page, lang };
}

function unavailablePage({ page = 'home', lang = 'kr' } = {}) {
  const en = lang === 'en';
  const title = en ? 'Unable to load this page' : '페이지를 불러오지 못했습니다';
  const description = en ? 'The latest information could not be loaded. Please try again shortly.' : '최신 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  const href = `${en ? '/en/' : '/'}${PUBLIC_PAGES[page]?.file || 'index.html'}`;
  return `<!doctype html><html lang="${en ? 'en' : 'ko'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · GEH Lab</title><style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(120deg,#10372f,#112633);color:#e5f4f3;font:17px/1.7 system-ui,sans-serif}main{max-width:40rem;margin:2rem;padding:2.5rem;border:1px solid #65878c;border-radius:2rem;background:#ffffff08}a{color:#a2d9ff}h1{margin:0 0 1rem}p{margin:0 0 1.5rem}</style></head><body><main><h1>${title}</h1><p>${description}</p><a href="${href}">${en ? 'Try again' : '다시 불러오기'}</a></main></body></html>`;
}

function waitForResponse(res, event, start) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off(event, done);
      res.off('error', failed);
      res.off('close', closed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = error => { cleanup(); reject(error); };
    const closed = () => failed(new Error('Response closed before completion.'));
    res.once(event, done);
    res.once('error', failed);
    res.once('close', closed);
    if (res.destroyed) return closed();
    try { start?.(); } catch (error) { failed(error); }
  });
}

async function send(res, status, html, head) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (head) {
    res.setHeader('Content-Length', Buffer.byteLength(html));
    await waitForResponse(res, 'finish', () => res.end());
    return;
  }
  // Public images can make the document larger than Vercel's buffered response
  // limit. Stream UTF-8 bytes and let the writable signal backpressure.
  res.removeHeader('Content-Length');
  res.flushHeaders();
  const bytes = Buffer.from(html, 'utf8');
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    if (res.destroyed || res.writableEnded) throw new Error('Response closed before completion.');
    if (!res.write(bytes.subarray(offset, offset + 64 * 1024))) await waitForResponse(res, 'drain');
  }
  await waitForResponse(res, 'finish', () => res.end());
}

export function createPublicPageHandler({ readCollection = name => sharedData.read(name), read = readFile, render = renderServerPublicPage, now = Date.now, cwd = () => process.cwd() } = {}) {
  const templates = new Map();
  const templateFor = async (page, lang) => {
    const key = `${lang}/${page}`;
    if (!templates.has(key)) {
      const path = `.server/${lang === 'en' ? 'en/' : ''}${PUBLIC_PAGES[page].file}`;
      const pending = read(resolve(cwd(), path), 'utf8').catch(error => { templates.delete(key); throw error; });
      templates.set(key, pending);
    }
    return templates.get(key);
  };
  return async (req, res) => {
    const head = req.method === 'HEAD';
    res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      await send(res, 405, unavailablePage(), head);
      return;
    }
    const route = requestRoute(req);
    if (!route) {
      await send(res, 400, unavailablePage(), head);
      return;
    }
    try {
      const { page, lang } = route;
      const names = PUBLIC_PAGES[page].collections;
      const [template, responses] = await Promise.all([
        templateFor(page, lang),
        Promise.allSettled(names.map(name => readCollection(name)))
      ]);
      const unavailableCollections = names.filter((_name, index) => responses[index].status !== 'fulfilled');
      // Keep healthy home sections and related content usable. A missing primary
      // collection still needs a retry page; failed data is never a successful [].
      if (unavailableCollections.length === names.length
        || (page !== 'home' && unavailableCollections.includes(names[0]))) throw new Error('Public data unavailable');
      const records = Object.fromEntries(names.flatMap((name, index) => responses[index].status === 'fulfilled' ? [[name, responses[index].value]] : []));
      const results = Object.values(records);
      const projectId = results[0].projectId;
      if (results.some(result => result.projectId !== projectId || !Array.isArray(result.items) || !Number.isFinite(result.fetchedAt))) throw new Error('Invalid public response');
      const html = await render(template, records, { page, lang, projectId, unavailableCollections });
      const remainingSeconds = Math.max(0, Math.floor(Math.min(...results.map(result => PUBLIC_CACHE_TTL_MS - Math.max(0, now() - result.fetchedAt))) / 1000));
      if (!unavailableCollections.length && results.every(result => !result.stale) && remainingSeconds > 0) res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${remainingSeconds}`);
      else res.setHeader('Cache-Control', 'no-store');
      await send(res, 200, html, head);
    } catch {
      // Headers already committed to a stream cannot become a second 503 page.
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.destroy();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', String(PUBLIC_RETRY_MS / 1000));
      await send(res, 503, unavailablePage(route), head);
    }
  };
}

export default createPublicPageHandler();
