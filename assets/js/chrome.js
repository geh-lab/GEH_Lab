import { PUBLIC_DATA_CHANGED } from './public-data-cache.js';
import { escapeHTML } from './utils.js';
import { setupImageFallbacks } from './portraits.js';
import { setupReadingPreferences } from './reading-preferences.js';
import { setupLiquidGlass } from './liquid-glass.js';
import '../css/liquid-glass.css';

// C direction: native links, an expanding glass dock, and separate preferences.
// This is a web glass treatment, not Apple's platform Liquid Glass renderer.
export function setupPublicChrome({ lang, page, loadSearch }) {
  document.documentElement.classList.add('js');
  setupImageFallbacks(document.body.dataset.root || '.');
  const en = lang === 'en';
  const header = document.querySelector('.site-header');
  const nav = header?.querySelector('[data-nav-panel]');
  if (!header || !nav) return;
  const utilities = header.querySelector('.site-utilities');
  document.body.append(utilities);
  utilities.classList.add('floating-tools');
  const toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'chrome-icon scroll-top';
  toTop.setAttribute('aria-label', en ? 'Back to top' : '맨 위로');
  toTop.innerHTML = '<span aria-hidden="true">↑</span>';
  utilities.prepend(toTop);
  const syncScroll = () => {
    toTop.hidden = window.scrollY < 180;
    header.classList.toggle('is-scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', syncScroll, { passive: true });
  toTop.addEventListener('click', () => {
    setPreferences(false);
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  syncScroll();
  const links = [...nav.querySelectorAll(':scope > a')];
  const labels = links.map(link => link.querySelector('.nav-label'));
  const labelText = labels.map(label => {
    const text = document.createElement('span');
    text.className = 'nav-label__text';
    text.textContent = label.textContent;
    label.replaceChildren(text);
    return text;
  });
  const current = links.find(link => link.dataset.navPage === page) || links[0];
  current?.classList.add('is-active');
  current?.setAttribute('aria-current', 'page');
  nav.setAttribute('aria-label', en ? 'Main navigation' : '주 메뉴');
  const lens = document.createElement('span');
  lens.className = 'site-nav__lens';
  lens.setAttribute('aria-hidden', 'true');
  nav.prepend(lens);
  let target = current;
  const dockReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let trackingFrame = 0;
  let trackingUntil = 0;
  let previousFrame = 0;
  let pointerMotion = false;
  let lensBox;
  const velocity = { x: 0, y: 0, width: 0, height: 0 };
  const targetBox = () => {
    if (!target?.isConnected || !target.getClientRects().length || getComputedStyle(lens).display === 'none') return null;
    const label = target.querySelector('.nav-label');
    const width = pointerMotion
      ? target.offsetWidth - label.offsetWidth + label.querySelector('.nav-label__text').scrollWidth + 8
      : target.offsetWidth;
    return { x: target.offsetLeft, y: target.offsetTop, width, height: target.offsetHeight };
  };
  const paintLens = () => {
    lens.style.width = `${lensBox.width}px`;
    lens.style.height = `${lensBox.height}px`;
    lens.style.transform = `translate3d(${lensBox.x}px,${lensBox.y}px,0)`;
  };
  // Critical damping keeps position and width continuous when hover changes direction.
  // Stop drawing once both the label layout and the lens have settled.
  const follow = now => {
    trackingFrame = 0;
    const goal = targetBox();
    if (!goal) return;
    const dt = Math.min(previousFrame ? (now - previousFrame) / 1000 : 1 / 60, .05);
    previousFrame = now;
    const frequency = 14;
    const decay = Math.exp(-frequency * dt);
    let settled = true;
    for (const key of Object.keys(velocity)) {
      const offset = lensBox[key] - goal[key];
      const step = (velocity[key] + frequency * offset) * dt;
      lensBox[key] = goal[key] + (offset + step) * decay;
      velocity[key] = (velocity[key] - frequency * step) * decay;
      if (Math.abs(lensBox[key] - goal[key]) > .1 || Math.abs(velocity[key]) > .5) settled = false;
    }
    if (settled && now >= trackingUntil) {
      lensBox = goal;
      Object.keys(velocity).forEach(key => { velocity[key] = 0; });
    } else trackingFrame = requestAnimationFrame(follow);
    paintLens();
  };
  const align = () => {
    if (pointerMotion && trackingFrame) return;
    const goal = targetBox();
    if (!goal) return;
    if (!pointerMotion || !lensBox) {
      cancelAnimationFrame(trackingFrame);
      trackingFrame = 0;
      lensBox = goal;
      Object.keys(velocity).forEach(key => { velocity[key] = 0; });
      paintLens();
    } else {
      previousFrame = 0;
      trackingFrame = requestAnimationFrame(follow);
    }
  };
  const select = (link, animate = false) => {
    target = link || current;
    pointerMotion = animate && !dockReducedMotion.matches && !header.classList.contains('is-compact');
    nav.classList.toggle('is-pointer-motion', pointerMotion);
    links.forEach(item => item.classList.toggle('is-lens-target', item === target));
    trackingUntil = performance.now() + 360;
    align();
  };
  links.forEach(link => {
    link.addEventListener('focus', () => select(link, !link.matches(':focus-visible')));
    link.addEventListener('pointerdown', event => select(link, event.pointerType === 'mouse'));
  });
  let pointerX;
  let pointerY;
  let pointerInNav = false;
  // Expanding labels can move a different link under a stationary pointer.
  // Only physical pointer movement may change the hover selection.
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || (event.clientX === pointerX && event.clientY === pointerY)) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (links.includes(link)) {
      pointerInNav = true;
      if (target !== link || !pointerMotion) select(link, true);
    } else if (pointerInNav && !nav.contains(event.target)) {
      pointerInNav = false;
      select(nav.contains(document.activeElement) ? document.activeElement.closest('a') : current, true);
    }
  }, { passive: true });
  nav.addEventListener('focusout', event => { if (!nav.contains(event.relatedTarget)) select(current); });
  dockReducedMotion.addEventListener('change', () => select(target));
  new ResizeObserver(align).observe(nav);
  select(current);
  document.fonts?.ready.then(align);

  const menuButton = header.querySelector('[data-menu-toggle]');
  const dock = header.querySelector('.dock-shell');
  const mobile = matchMedia('(max-width: 980px)');
  let compact = mobile.matches;
  const setMenu = (open, restore = false) => {
    // A backdrop-filter ancestor prevents the popover from blurring the page.
    // Place the mobile menu beside the dock and restore it inside on desktop.
    if (compact && nav.parentElement !== header) header.append(nav);
    else if (!compact && nav.parentElement !== dock) menuButton.after(nav);
    nav.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', en ? (open ? 'Close menu' : 'All pages') : (open ? '메뉴 닫기' : '전체 메뉴'));
    menuButton.classList.toggle('is-open', open);
    nav.toggleAttribute('inert', compact && !open);
    nav.setAttribute('aria-hidden', String(compact && !open));
    if (restore) menuButton.focus({ preventScroll: true });
    select(current);
  };
  nav.id = 'site-navigation';
  menuButton.setAttribute('aria-controls', nav.id);
  menuButton.addEventListener('click', event => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    if (open) { setPreferences(false); setSearch(false); }
    setMenu(open);
    if (open && event.detail === 0) current?.focus();
  });
  const updateHeaderSpace = () => {
    const bottom = `${Math.ceil(header.getBoundingClientRect().bottom)}px`;
    if (document.documentElement.style.getPropertyValue('--site-header-bottom') !== bottom) {
      document.documentElement.style.setProperty('--site-header-bottom', bottom);
    }
  };
  const fitHeader = () => {
    const hadNavFocus = nav.contains(document.activeElement);
    compact = mobile.matches;
    header.classList.toggle('is-compact', compact);
    setMenu(false);
    if (!compact) {
      // Reserve room for the longest label, including one opened by keyboard or hover.
      labels.forEach((label, index) => label.style.setProperty('--nav-label-width', `${labelText[index].scrollWidth}px`));
      const shownWidth = labels.reduce((sum, label) => sum + label.getBoundingClientRect().width, 0);
      const longestWidth = Math.max(...labelText.map(text => text.scrollWidth + 8));
      const dockWidth = dock.getBoundingClientRect().width - shownWidth + longestWidth;
      const sideWidth = Math.max(
        header.querySelector('.brand')?.scrollWidth || 0,
        header.querySelector('.header-language')?.scrollWidth || 0
      );
      const gap = Number.parseFloat(getComputedStyle(header).columnGap) || 0;
      compact = dockWidth + sideWidth * 2 + gap * 2 > header.clientWidth;
      header.classList.toggle('is-compact', compact);
      setMenu(false, compact && hadNavFocus);
    }
    updateHeaderSpace();
  };
  let headerFrame = 0;
  const scheduleHeaderFit = () => {
    if (headerFrame) return;
    headerFrame = requestAnimationFrame(() => { headerFrame = 0; fitHeader(); });
  };
  window.addEventListener('resize', scheduleHeaderFit, { passive: true });
  new MutationObserver(scheduleHeaderFit).observe(document.documentElement, { attributes: true, attributeFilter: ['data-text-size'] });
  new ResizeObserver(updateHeaderSpace).observe(header);
  document.fonts?.ready.then(scheduleHeaderFit);
  fitHeader();

  const preferences = utilities.querySelector('[data-preferences-panel]');
  setupReadingPreferences(preferences);
  const preferencesButton = utilities.querySelector('[data-preferences-toggle]');
  const setPreferences = (open, restore = false) => {
    preferences.hidden = !open;
    preferencesButton.setAttribute('aria-expanded', String(open));
    if (restore) preferencesButton.focus({ preventScroll: true });
  };
  preferencesButton.addEventListener('click', () => { setMenu(false); setSearch(false); setPreferences(preferences.hidden); });
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = localStorage.getItem('geh-theme') || 'system'; } catch { /* Session preference still works. */ }
  const themeButtons = [...preferences.querySelectorAll('[data-theme-choice]')];
  const applyTheme = () => {
    if (!['light', 'dark', 'system'].includes(preference)) preference = 'system';
    document.documentElement.dataset.themePreference = preference;
    const resolved = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    themeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference)));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#101a20' : '#f5f7f8';
  };
  themeButtons.forEach(button => button.addEventListener('click', () => {
    preference = button.dataset.themeChoice;
    try { localStorage.setItem('geh-theme', preference); } catch { /* Private mode can block storage. */ }
    applyTheme();
  }));
  systemTheme.addEventListener('change', applyTheme);
  window.addEventListener('storage', event => {
    if (event.key === 'geh-theme' || event.key === null) { preference = event.newValue || 'system'; applyTheme(); }
  });
  applyTheme();

  const searchButton = header.querySelector('[data-global-search-toggle]');
  const search = header.querySelector('[data-global-search]');
  const searchInput = search.querySelector('input');
  const results = search.querySelector('[data-search-results]');
  const searchStatus = search.querySelector('[data-search-status]');
  let searchItems = [];
  let searchLoading = false;
  let partial = false;
  let searchRevision = 0;
  let searchQueued = false;
  let searchTimer = null;
  function renderSearch() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const matches = searchItems.filter(item => `${item.title} ${item.search || ''} ${item.group}`.toLocaleLowerCase().includes(query));
    results.innerHTML = matches.slice(0, 6).map(item => `<a href="${escapeHTML(item.href)}"><small>${escapeHTML(item.group)}</small><span>${escapeHTML(item.title)}</span></a>`).join('');
    searchStatus.textContent = searchLoading
      ? (en ? 'Loading research and people…' : '멤버와 연구 정보를 불러오는 중…')
      : partial
        ? (en ? 'Some collections could not be loaded. Available results are shown.' : '일부 자료를 불러오지 못해 확인 가능한 결과를 표시합니다.')
        : matches.length ? (en ? `${matches.length} results${matches.length > 6 ? ' · first 6 shown' : ''}` : `${matches.length}건${matches.length > 6 ? ' · 상위 6건 표시' : ''}`)
          : (en ? 'No results found.' : '검색 결과가 없습니다.');
  }
  function refreshSearch() {
    window.clearTimeout(searchTimer);
    if (search.hidden || document.hidden) return;
    if (searchLoading) { searchQueued = true; return; }
    const revision = searchRevision;
    searchLoading = true;
    renderSearch();
    Promise.resolve().then(loadSearch).then(data => {
      if (revision !== searchRevision) { searchQueued = true; return; }
      searchItems = data.items;
      partial = data.partial;
    }).catch(() => { partial = true; }).finally(() => {
      searchLoading = false;
      if (searchQueued && !search.hidden && !document.hidden) {
        searchQueued = false;
        refreshSearch();
      } else {
        searchQueued = false;
        renderSearch();
        if (!search.hidden && !document.hidden) searchTimer = window.setTimeout(refreshSearch, 60000);
      }
    });
  }
  function setSearch(open, restore = false) {
    search.hidden = !open;
    searchButton.setAttribute('aria-expanded', String(open));
    header.classList.toggle('is-searching', open);
    if (open) {
      setPreferences(false); setMenu(false); searchInput.focus({ preventScroll: true });
      refreshSearch();
    } else {
      window.clearTimeout(searchTimer);
      if (restore) searchButton.focus({ preventScroll: true });
    }
  }
  window.addEventListener(PUBLIC_DATA_CHANGED, () => {
    searchRevision += 1;
    refreshSearch();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearTimeout(searchTimer);
    else refreshSearch();
  });
  window.addEventListener('pagehide', () => window.clearTimeout(searchTimer));
  window.addEventListener('pageshow', refreshSearch);
  searchButton.addEventListener('click', () => setSearch(search.hidden, !search.hidden));
  search.querySelector('[data-search-close]').addEventListener('click', () => setSearch(false, true));
  search.querySelector('form').addEventListener('submit', event => event.preventDefault());
  searchInput.addEventListener('input', renderSearch);
  document.addEventListener('click', event => {
    if (!header.contains(event.target) && !utilities.contains(event.target)) { setPreferences(false); setMenu(false); setSearch(false); }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!search.hidden) { setSearch(false, true); event.preventDefault(); }
    else if (!preferences.hidden) { setPreferences(false, true); event.preventDefault(); }
    else if (nav.classList.contains('is-open')) { setMenu(false, true); event.preventDefault(); }
  });

  const hero = document.querySelector('.hero');
  if (hero) {
    new IntersectionObserver(([entry]) => header.classList.toggle('over-hero', entry.isIntersecting), { rootMargin: '-100px 0px 0px 0px' }).observe(hero);
    header.classList.add('over-hero');
  }
  setupLiquidGlass();

}
