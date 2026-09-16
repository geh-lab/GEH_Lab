import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PUBLIC_PAGE_ROUTES } from './scripts/prepare-public-pages.mjs';

const page = (path) => resolve(process.cwd(), path);

export default defineConfig({
  plugins: [{
    name: 'geh-preview-server-pages',
    configurePreviewServer(server) {
      let handler;
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const pathname = url.pathname === '/en/' ? '/en' : url.pathname;
        if (pathname === '/board.html' || pathname === '/en/board.html') {
          res.writeHead(308, { Location: `${pathname.replace('board.html', 'news.html')}${url.search}` });
          res.end();
          return;
        }
        const route = PUBLIC_PAGE_ROUTES.find(candidate => candidate.source === pathname);
        if (!route && pathname !== '/api/public-page') return next();
        if (route) req.query = { ...Object.fromEntries(url.searchParams), page: route.page, lang: route.lang };
        try {
          // Load the Node response handler only during preview, never into a browser bundle.
          handler ||= import(/* @vite-ignore */ pathToFileURL(page('api/public-page.js')).href).then(module => module.default);
          await (await handler)(req, res);
        } catch (error) {
          server.config.logger.error(`Public page preview failed: ${error.message}`);
          if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end('페이지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
      });
    }
  }, {
    name: 'geh-copy-runtime-static',
    async writeBundle() {
      await mkdir(page('dist/assets/images'), { recursive: true });
      await cp(page('assets/images'), page('dist/assets/images'), {
        recursive: true,
        filter: (source) => ![
          'assets/images/flags/kr.svg',
          'assets/images/flags/us.svg',
          'assets/images/background/research-map.png',
          'assets/images/mainpic.png',
          'assets/images/mainpic.webp',
          'assets/images/logos/cnu-emblem-blue.jpg',
          'assets/images/logos/cnu-emblem-white.jpg',
          'assets/images/members/jongseok-park.png',
          'assets/images/members/kwangya-lee.png'
        ].some((unused) => source.endsWith(unused))
      });
      await Promise.all([
        'firebase-config.js',
        'robots.txt',
        'sitemap.xml',
        'google151a89db5aea8faf.html'
      ].map((file) => cp(page(file), page(`dist/${file}`))));
    }
  }],
  server: {
    allowedHosts: true
  },
  build: {
    rollupOptions: {
      input: {
        home: page('index.html'),
        members: page('members.html'),
        projects: page('projects.html'),
        publications: page('publications.html'),
        patents: page('patents.html'),
        news: page('news.html'),
        board: page('board.html'),
        contact: page('contact.html'),
        admin: page('admin.html'),
        enHome: page('en/index.html'),
        enMembers: page('en/members.html'),
        enProjects: page('en/projects.html'),
        enPublications: page('en/publications.html'),
        enPatents: page('en/patents.html'),
        enNews: page('en/news.html'),
        enBoard: page('en/board.html'),
        enContact: page('en/contact.html')
      }
    }
  }
});
