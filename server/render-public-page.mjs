import { parseHTML } from 'linkedom';
import { createPublicPage } from '../assets/js/public-renderer.js';

const COLLECTIONS = Object.freeze({
  members: 'members', projects: 'projects', publications: 'publications',
  patents: 'patents', board: 'boardPosts'
});

// JSON lives in an HTML script element; a stored title must not end that element.
const safeJson = value => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function addJson(document, id, value, type = 'application/json', parent = document.head) {
  const script = document.createElement('script');
  script.id = id;
  script.type = type;
  script.textContent = safeJson(value);
  parent.append(script);
}

function updateMemberStructuredData(document, members, lang) {
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (!canonical) return;
  const lists = [
    ['current-members', members.filter(member => member.status !== 'alumni' && member.group !== 'alumni')],
    ['alumni', members.filter(member => member.status === 'alumni' || member.group === 'alumni')]
  ];
  addJson(document, 'member-roster-structured-data', {
    '@context': 'https://schema.org',
    '@graph': lists.map(([id, items]) => ({
      '@type': 'ItemList', '@id': `${canonical}#${id}`, numberOfItems: items.length,
      itemListElement: items.map((member, index) => ({
        '@type': 'ListItem', position: index + 1,
        item: {
          '@type': 'Person', '@id': `${canonical}#member-${encodeURIComponent(member.id)}`,
          name: lang === 'en' ? member.nameEn || member.nameKr || member.name : member.nameKr || member.name,
          url: canonical,
          memberOf: { '@id': 'https://geh-lab.vercel.app/#organization' }
        }
      }))
    }))
  }, 'application/ld+json');
}

export function renderServerPublicPage(template, records, { page, lang, projectId, unavailableCollections = [] }) {
  // A new DOM and renderer closure for every request keep locales/data isolated.
  // LinkeDOM parses markup only: it does not run scripts or fetch images/modules.
  const { document } = parseHTML(template);
  if (document.body.dataset.page !== page || document.body.dataset.lang !== lang) {
    throw new Error('Public page template does not match the requested route');
  }
  const base = document.createElement('base');
  base.setAttribute('href', lang === 'en' ? '/en/' : '/');
  document.querySelectorAll('base').forEach(element => element.remove());
  document.head.prepend(base);
  document.querySelectorAll('#member-roster-data, #member-roster-structured-data, #public-page-data, #member-roster-boot-style, .member-roster-status')
    .forEach(element => element.remove());
  document.querySelectorAll('script:not([src])').forEach(script => {
    if (script.textContent.includes('GEH_BOOT_TIMEOUT')) script.remove();
  });
  const noNetwork = () => { throw new Error('Rendering must use the supplied public records'); };
  const renderer = createPublicPage({
    document,
    window: { matchMedia: () => ({ matches: true }), GEH_FIREBASE_CONFIG: { projectId } },
    serverRender: true,
    setupPublicChrome: noNetwork,
    firebaseApi: {
      COLLECTIONS, hasFirebaseConfig: true, isLocalDevMode: false,
      fetchCollectionResult: noNetwork, readCachedCollection: () => null
    },
    cacheApi: { PUBLIC_DATA_CHANGED: 'geh:public-data-changed', getPublicCollectionRevision: () => 0, seedPublicCollection: noNetwork }
  });
  const state = renderer.renderServer(records, unavailableCollections);
  if (page === 'members') updateMemberStructuredData(document, state.members, lang);

  document.documentElement.classList.remove('member-roster-pending', 'js-fallback');
  document.documentElement.classList.add('server-rendered');
  const navigation = document.querySelector('[data-nav-panel]');
  navigation?.setAttribute('aria-label', lang === 'en' ? 'Main navigation' : '주 메뉴');
  navigation?.querySelectorAll('a[data-nav-page]').forEach(link => {
    const current = link.dataset.navPage === page;
    link.classList.toggle('is-active', current);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.reveal').forEach(element => element.classList.add('is-visible'));
  document.querySelectorAll('.count-up').forEach(element => {
    element.textContent = String(Number(element.dataset.target || '0'));
    // Populated HTML is ready to read, but browser motion has not run yet.
    element.removeAttribute('data-counted');
    element.removeAttribute('data-counting');
  });
  // DOM listeners are not serialized. Let the browser attach them on startup.
  document.querySelectorAll('[data-bound], [data-reveal-bound], [data-count-bound]').forEach(element => {
    ['data-bound', 'data-reveal-bound', 'data-count-bound'].forEach(name => element.removeAttribute(name));
  });
  const style = document.createElement('style');
  style.id = 'public-page-ready-style';
  style.textContent = '.server-rendered .reveal{opacity:1!important;transform:none!important}';
  document.head.append(style);
  const runtime = document.createElement('script');
  // npm preview serves the same server HTML as production, including cache reuse.
  runtime.textContent = 'window.GEH_LOCAL_DEV_MODE=false;';
  document.head.append(runtime);
  // Large inline photographs in Firestore must not delay parsing visible cards.
  // Deferred browser modules still see this payload before DOMContentLoaded.
  addJson(document, 'public-page-data', { projectId, collections: records, unavailableCollections }, 'application/json', document.body);
  return document.toString();
}
