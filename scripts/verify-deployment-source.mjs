import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGE_FILES, PUBLIC_PAGE_ROUTES } from './prepare-public-pages.mjs';

const requiredFiles = [
  'api/public-page.js', 'server/render-public-page.mjs', 'server/public-data.mjs',
  'assets/js/public-entry.js', 'assets/js/public.js', 'assets/js/public-renderer.js', 'assets/js/firebase-public.js',
  'assets/js/public-data-cache.js', 'assets/js/collection-cache.js', 'assets/js/chrome.js',
  'assets/css/icons.css', 'firebase-config.js', 'vite.config.js',
  'scripts/generate-member-roster.mjs', 'scripts/verify-build.mjs', 'scripts/prepare-public-pages.mjs'
];

export async function verifyDeploymentSource(projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), { normalize = true } = {}) {
  const missing = [];
  for (const file of requiredFiles) await access(resolve(projectRoot, file)).catch(() => missing.push(file));
  if (missing.length) throw new Error(`배포 필수 파일이 누락되었습니다. 전체 수정본을 같은 프로젝트 루트에 올려 주세요: ${missing.join(', ')}`);
  const config = JSON.parse(await readFile(resolve(projectRoot, 'vercel.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
  if (config.outputDirectory !== 'dist' || config.buildCommand !== 'npm run build' || config.builds || config.routes) {
    throw new Error('vercel.json이 서버 페이지 배포 설정과 다릅니다. 현재 수정본 전체를 업로드해 주세요.');
  }
  const functionConfig = config.functions?.['api/public-page.js'];
  if (functionConfig?.includeFiles !== '{.server/**,firebase-config.js}' || functionConfig.maxDuration < 10) throw new Error('서버 함수 또는 .server 템플릿 포함 설정이 누락되었습니다.');
  for (const route of PUBLIC_PAGE_ROUTES) {
    const matches = (config.rewrites || []).filter(candidate => candidate.source === route.source);
    if (matches.length !== 1 || matches[0].destination !== route.destination) throw new Error(`서버 페이지 경로 설정이 누락되었습니다: ${route.source}`);
  }
  const build = pkg.scripts?.build || '';
  const steps = ['scripts/verify-deployment-source.mjs', 'generate:profiles', 'vite.js build', 'scripts/verify-build.mjs', 'scripts/prepare-public-pages.mjs'];
  if (steps.some((step, index) => build.indexOf(step) < 0 || (index > 0 && build.indexOf(step) <= build.indexOf(steps[index - 1])))) {
    throw new Error('빌드 명령에 배포 사전 검사 또는 서버 페이지 준비 단계가 누락되었습니다.');
  }
  if (!pkg.dependencies?.linkedom) throw new Error('서버 렌더러에 필요한 linkedom 의존성이 누락되었습니다.');
  const handler = await readFile(resolve(projectRoot, 'api/public-page.js'), 'utf8');
  const renderer = await readFile(resolve(projectRoot, 'server/render-public-page.mjs'), 'utf8');
  const entry = await readFile(resolve(projectRoot, 'assets/js/public-entry.js'), 'utf8');
  const bootstrap = await readFile(resolve(projectRoot, 'assets/js/public.js'), 'utf8');
  const sharedRenderer = await readFile(resolve(projectRoot, 'assets/js/public-renderer.js'), 'utf8');
  if (!handler.includes('render-public-page.mjs') || !handler.includes('createPublicPageHandler')
    || !renderer.includes('renderServerPublicPage') || !renderer.includes('public-renderer.js')
    || !entry.includes("'./public.js'") || !bootstrap.includes('createPublicPage') || !sharedRenderer.includes('export function createPublicPage')) {
    throw new Error('서버·브라우저 시작 파일 버전이 서로 다릅니다. 전체 수정본으로 교체해 주세요.');
  }
  if (/\bfrom\s*["']\.[^"']*\?[^"']*["']/.test(sharedRenderer)) throw new Error('서버 공용 렌더러의 import 경로에는 쿼리 문자열을 넣을 수 없습니다. Vercel 파일 추적에서 누락됩니다.');

  // Older HTML can survive a partial file upload. Normalize its module entry
  // before Vite bundles it, so a factory-only public.js cannot become the entry.
  const changed = [];
  for (const lang of ['kr', 'en']) {
    for (const file of [...Object.values(PUBLIC_PAGE_FILES), 'contact.html', 'board.html']) {
      const relative = `${lang === 'en' ? 'en/' : ''}${file}`;
      const path = resolve(projectRoot, relative);
      const original = await readFile(path, 'utf8');
      let count = 0;
      const html = original.replace(/<script\b(?=[^>]*\btype=["']module["'])([^>]*\bsrc=["'])([^"']+)(["'][^>]*)>/g, (tag, before, source, after) => {
        if (!/^(?:\.\.\/|\.\/)?assets\/js\/public(?:-entry)?\.js(?:[?#].*)?$/.test(source)) return tag;
        count++;
        return `<script${before}${source.replace(/\/public\.js(?=[?#]|$)/, '/public-entry.js')}${after}>`;
      });
      if (count !== 1) throw new Error(`공개 페이지 시작 스크립트가 없거나 중복되었습니다: ${relative}`);
      if (html !== original) changed.push({ relative, path, html });
    }
  }
  if (!normalize && changed.length) throw new Error(`공개 페이지 시작 스크립트 갱신이 필요합니다: ${changed.map(file => file.relative).join(', ')}`);
  for (const file of changed) await writeFile(file.path, file.html, 'utf8');
  console.log(`Deployment source verified (server function, renderer, browser entry, ${PUBLIC_PAGE_ROUTES.length} routes; ${changed.length} legacy HTML entries repaired).`);
  return { repairedEntries: changed.map(file => file.relative) };
}

async function testDeploymentSource() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const folder = await mkdtemp(resolve(tmpdir(), 'geh-deployment-source-test-'));
  try {
    const pageFiles = ['kr', 'en'].flatMap(lang => [...Object.values(PUBLIC_PAGE_FILES), 'contact.html', 'board.html'].map(file => `${lang === 'en' ? 'en/' : ''}${file}`));
    for (const file of [...requiredFiles, ...pageFiles, 'package.json', 'vercel.json']) {
      await mkdir(dirname(resolve(folder, file)), { recursive: true });
      await cp(resolve(root, file), resolve(folder, file));
    }
    const index = resolve(folder, 'index.html');
    const original = await readFile(index, 'utf8');
    await writeFile(index, original.replace('assets/js/public-entry.js', 'assets/js/public.js'));
    assert.deepEqual((await verifyDeploymentSource(folder)).repairedEntries, ['index.html']);
    assert.equal(await readFile(index, 'utf8'), original);
    assert.deepEqual((await verifyDeploymentSource(folder)).repairedEntries, []);
    await rm(resolve(folder, 'api/public-page.js'));
    await assert.rejects(verifyDeploymentSource(folder), /api\/public-page\.js/);
    await cp(resolve(root, 'api/public-page.js'), resolve(folder, 'api/public-page.js'));
    const config = JSON.parse(await readFile(resolve(folder, 'vercel.json'), 'utf8'));
    config.rewrites.pop();
    await writeFile(resolve(folder, 'vercel.json'), JSON.stringify(config));
    await assert.rejects(verifyDeploymentSource(folder), /경로 설정/);
    console.log('Deployment source regression checks passed (legacy repair, idempotence, missing function and missing route rejection).');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--test')) await testDeploymentSource();
  else await verifyDeploymentSource();
}
