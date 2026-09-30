import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import * as utils from '../assets/js/utils.js';
import * as patents from '../assets/js/patents.js';
import * as inventors from '../assets/js/patent-inventors.js';
import * as data from '../assets/js/data.js';
import { getPublicPageSource } from './public-test-source.mjs';

const channelUrl = 'https://www.youtube.com/channel/UCm8LNOlblBcd1Giwsm6R_aw/';
const source = (await getPublicPageSource()).replace(/^import\s+[\s\S]*?;\s*$/gm, '');
const post = {
  id: 'youtube-announcement', category: 'other', title: 'Lab YouTube channel',
  description: 'Research videos from our lab.', date: '2026-09-30', linkUrl: channelUrl
};

// Run production rendering and card events offline; only capture the modal shell.
function runtime(lang) {
  const { document, Event } = parseHTML(`<html><body data-page="home" data-lang="${lang}" data-root="."></body></html>`);
  const modals = [];
  const api = vm.runInNewContext(`(() => { ${source}\n
    openModal = (title, html) => captureModal(title, html);
    return { state, homeNewsCard, boardCard, openBoardModal, bindInteractiveCards, isYouTubeChannelUrl };
  })()`, {
    ...utils, ...patents, ...inventors, ...data, document, URL, URLSearchParams, console,
    window: { matchMedia: () => ({ matches: true }), open() { throw new Error('Home cards must open local details.'); } },
    localStorage: { getItem: () => null }, hasFirebaseConfig: false, isLocalDevMode: true,
    COLLECTIONS: { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts' },
    refreshImageFallbacks() {}, captureModal: (title, html) => modals.push({ title, html }),
    fetch() { throw new Error('YouTube channel tests must never contact a server.'); }
  }, { filename: 'public-renderer.js' });
  api.state.board = [post];
  return { ...api, document, Event, modals };
}

function fragment(html) {
  return parseHTML(`<html><body>${html}</body></html>`).document;
}

function externalLink(document, href, label) {
  const matches = [...document.querySelectorAll('a')].filter((link) => link.getAttribute('href') === href);
  assert.equal(matches.length, 1, `Expected one action for ${href}`);
  const link = matches[0];
  assert.equal(link.textContent.trim(), label);
  assert.equal(link.getAttribute('target'), '_blank');
  const rel = link.getAttribute('rel').split(/\s+/);
  assert.ok(rel.includes('noopener') && rel.includes('noreferrer'));
  return link;
}

for (const lang of ['kr', 'en']) {
  const r = runtime(lang);
  const channelLabel = lang === 'en' ? 'Visit YouTube channel' : 'YouTube 채널 보기';
  const genericLabel = lang === 'en' ? 'Open link' : '링크 열기';
  const categoryLabel = lang === 'en' ? 'News & articles' : '소식·기사';
  r.document.body.innerHTML = r.homeNewsCard(post);
  const homeCard = r.document.querySelector('[data-board-id]');
  assert.equal(homeCard.dataset.boardId, post.id);
  assert.equal(homeCard.getAttribute('role'), 'button');
  assert.equal(homeCard.getAttribute('tabindex'), '0');
  assert.equal(homeCard.querySelector('.member-chip').textContent, categoryLabel);
  assert.deepEqual([...homeCard.querySelectorAll('.home-news-indicator')].map((node) => node.textContent), ['YouTube']);
  assert.ok(homeCard.querySelector('.home-news-card__media--placeholder .ph-youtube-logo'));
  assert.equal(homeCard.querySelector('a, iframe'), null, 'The home card opens details before the external channel');
  r.bindInteractiveCards();
  r.bindInteractiveCards();
  for (const action of ['click', 'Enter', ' ']) {
    const event = new r.Event(action === 'click' ? 'click' : 'keydown', { bubbles: true, cancelable: true });
    if (action !== 'click') event.key = action;
    const previousCount = r.modals.length;
    homeCard.dispatchEvent(event);
    assert.equal(r.modals.length, previousCount + 1, 'Each card interaction must open one modal');
    assert.equal(r.modals.at(-1).title, post.title);
    const modal = fragment(r.modals.at(-1).html);
    externalLink(modal, channelUrl, channelLabel);
    assert.equal(modal.querySelector('iframe'), null, 'A channel is an external link, not an embedded video');
  }
  const board = fragment(r.boardCard(post));
  externalLink(board, channelUrl, channelLabel);
  assert.equal(board.querySelector('iframe'), null);
  assert.equal(board.querySelector('.member-chip').textContent, categoryLabel);

  for (const youtubeUrl of [
    'https://www.youtube.com/watch?v=AbC123_xYz0',
    'https://youtu.be/AbC123_xYz0',
    'https://www.youtube.com/shorts/AbC123_xYz0'
  ]) {
    const videoPost = { ...post, youtubeUrl };
    r.openBoardModal(videoPost);
    for (const html of [r.modals.at(-1).html, r.boardCard(videoPost)]) {
      const rendered = fragment(html);
      assert.equal(rendered.querySelectorAll('iframe').length, 1);
      assert.equal(rendered.querySelector('iframe').getAttribute('src'), 'https://www.youtube.com/embed/AbC123_xYz0');
      externalLink(rendered, channelUrl, channelLabel);
    }
  }

  for (const linkUrl of ['https://example.test/news?from=lab&issue=2', 'https://www.youtube.com.evil.test/@lab']) {
    const linkedPost = { ...post, linkUrl };
    r.openBoardModal(linkedPost);
    for (const html of [r.modals.at(-1).html, r.boardCard(linkedPost)]) {
      externalLink(fragment(html), linkUrl, genericLabel);
    }
    const home = fragment(r.homeNewsCard(linkedPost));
    assert.equal(home.querySelector('.home-news-indicator').textContent, lang === 'en' ? 'Link' : '링크');
    assert.equal(home.querySelector('.ph-youtube-logo'), null);
  }
}
console.log('YouTube board checks passed: localized channel actions, home-card interactions, ordinary links and existing video embeds.');

const { isYouTubeChannelUrl } = runtime('en');
for (const hostname of ['youtube.com', 'www.youtube.com', 'm.youtube.com']) {
  for (const path of ['/channel/UCm8LNOlblBcd1Giwsm6R_aw/', '/@GEHLab', '/c/GEHLab', '/user/GEHLab/']) {
    assert.equal(isYouTubeChannelUrl(`https://${hostname}${path}`), true);
  }
}
for (const url of [
  '', 'not a URL', 'http://www.youtube.com/@lab', 'https://youtube.com.evil.test/@lab',
  'https://youtube.com@evil.test/@lab', 'https://notyoutube.com/channel/lab',
  'https://youtu.be/AbC123_xYz0', 'https://www.youtube.com/watch?v=AbC123_xYz0',
  'https://www.youtube.com/shorts/AbC123_xYz0', 'https://www.youtube.com/channel/',
  'https://www.youtube.com/', 'https://www.youtube.com/@lab/videos'
]) assert.equal(isYouTubeChannelUrl(url), false, `Must not label this URL as a channel: ${url}`);
console.log('YouTube URL checks passed: supported channel paths and exact HTTPS host matching.');

for (const prefix of ['', 'en/']) {
  for (const page of ['index', 'members', 'projects', 'publications', 'patents', 'news', 'board', 'contact']) {
    const html = await readFile(new URL(`../${prefix}${page}.html`, import.meta.url), 'utf8');
    const document = fragment(html);
    const footers = document.querySelectorAll('footer.site-footer');
    assert.equal(footers.length, 1, `Expected a single footer on ${prefix}${page}.html`);
    const footer = footers[0];
    const channel = externalLink(footer, channelUrl, prefix ? 'Lab YouTube' : '연구실 YouTube');
    assert.ok(channel.classList.contains('footer-youtube'));
    assert.equal(channel.getAttribute('aria-label'), prefix ? 'Lab YouTube (opens in a new tab)' : '연구실 YouTube (새 탭에서 열림)');
    assert.equal(channel.querySelector('.ph-youtube-logo')?.getAttribute('aria-hidden'), 'true');
    assert.equal(footer.querySelectorAll('.footer-admin').length, 1);
    const admin = footer.querySelector('.footer-admin');
    assert.equal(admin.getAttribute('href'), prefix ? '../admin.html' : 'admin.html');
    assert.equal(admin.textContent.trim(), prefix ? 'Administrator' : '관리자');
  }
}
console.log('YouTube footer checks passed: all 16 static pages have the localized channel link and retain their admin link.');
