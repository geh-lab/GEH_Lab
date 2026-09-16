import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_PAGE_FILES = Object.freeze({
  home: 'index.html', members: 'members.html', projects: 'projects.html',
  publications: 'publications.html', patents: 'patents.html', board: 'news.html'
});

export const PUBLIC_PAGE_ROUTES = Object.freeze(['kr', 'en'].flatMap(lang => (
  Object.entries(PUBLIC_PAGE_FILES).flatMap(([page, file]) => {
    const prefix = lang === 'en' ? '/en/' : '/';
    const sources = page === 'home' ? [lang === 'en' ? '/en' : '/', `${prefix}${file}`] : [`${prefix}${file}`];
    return sources.map(source => ({ source, page, lang, destination: `/api/public-page?page=${page}&lang=${lang}` }));
  })
)));

export async function preparePublicPages(projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const config = JSON.parse(await readFile(resolve(projectRoot, 'vercel.json'), 'utf8'));
  for (const route of PUBLIC_PAGE_ROUTES) {
    const matches = (config.rewrites || []).filter(candidate => candidate.source === route.source);
    if (matches.length !== 1 || matches[0].destination !== route.destination) throw new Error(`Missing public page rewrite: ${route.source}`);
  }
  const functionConfig = config.functions?.['api/public-page.js'];
  if (functionConfig?.includeFiles !== '{.server/**,firebase-config.js}' || functionConfig.maxDuration < 10) throw new Error('Public page function templates or timeout are not configured.');
  for (const prefix of ['', '/en']) {
    if (!(config.redirects || []).some(route => route.source === `${prefix}/board.html` && route.destination === `${prefix}/news.html`)) throw new Error('The legacy board redirect is missing.');
  }

  // Validate every built page before moving any files. Vercel serves static files
  // before rewrites, so no public HTML copy can remain at a rewritten path.
  const templates = [];
  for (const lang of ['kr', 'en']) {
    for (const [page, file] of Object.entries(PUBLIC_PAGE_FILES)) {
      const relative = `${lang === 'en' ? 'en/' : ''}${file}`;
      const source = resolve(projectRoot, 'dist', relative);
      const html = await readFile(source, 'utf8');
      if (!/<!doctype html>/i.test(html) || !html.includes(`data-page="${page}"`) || !html.includes(`data-lang="${lang}"`) || !/<script\b[^>]*type="module"[^>]*src="\/assets\//.test(html)) {
        throw new Error(`Public page template is incomplete: ${relative}`);
      }
      if (!/<script\b[^>]*type="module"[^>]*src="\/assets\/public-entry-[^/]+\.js"/.test(html)) {
        throw new Error(`Public page startup bundle is missing: ${relative}`);
      }
      templates.push({ relative, source, target: resolve(projectRoot, '.server', relative) });
    }
  }
  await rm(resolve(projectRoot, '.server'), { recursive: true, force: true });
  await mkdir(resolve(projectRoot, '.server/en'), { recursive: true });
  for (const template of templates) await rename(template.source, template.target);
  for (const relative of ['board.html', 'en/board.html']) await rm(resolve(projectRoot, 'dist', relative), { force: true });

  for (const template of templates) {
    await access(template.target);
    const remains = await access(template.source).then(() => true, () => false);
    if (remains) throw new Error(`A static page is shadowing its server response: ${template.relative}`);
  }
  for (const relative of ['contact.html', 'en/contact.html', 'admin.html', 'firebase-config.js', 'assets']) await access(resolve(projectRoot, 'dist', relative));
  console.log(`Public server pages prepared (${templates.length} templates, ${PUBLIC_PAGE_ROUTES.length} routes; no static route collisions).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePublicPages();
