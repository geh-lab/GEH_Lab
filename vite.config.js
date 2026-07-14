import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cp, mkdir } from 'node:fs/promises';

const page = (path) => resolve(process.cwd(), path);

export default defineConfig({
  plugins: [{
    name: 'geh-copy-runtime-static',
    async writeBundle() {
      await mkdir(page('dist/assets/images'), { recursive: true });
      await cp(page('assets/images'), page('dist/assets/images'), {
        recursive: true,
        filter: (source) => ![
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
        news: page('news.html'),
        board: page('board.html'),
        contact: page('contact.html'),
        admin: page('admin.html'),
        enHome: page('en/index.html'),
        enMembers: page('en/members.html'),
        enProjects: page('en/projects.html'),
        enPublications: page('en/publications.html'),
        enNews: page('en/news.html'),
        enBoard: page('en/board.html'),
        enContact: page('en/contact.html')
      }
    }
  }
});
