import { escapeHTML, getInitials, rootAsset } from './utils.js';

// Both the generated roster and live updates use the same image framing/fallback.
export function portraitMarkup({ source = '', name = '', initialsName = name, root = '.', size = 128, eager = false }) {
  const initials = getInitials(initialsName) || '·';
  const fallback = `<span class="portrait-fallback" aria-hidden="true">${escapeHTML(initials)}</span>`;
  if (!source) return fallback;
  return `${fallback}<img data-portrait-image src="${escapeHTML(rootAsset(source, root))}" alt="" width="${size}" height="${size}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${eager ? ' fetchpriority="high"' : ''}>`;
}

function recoverImage(image, root) {
  if (image.matches('[data-portrait-image]')) {
    image.hidden = true;
    return;
  }
  if (!image.dataset.logoAsset) return;
  // Old open tabs can still reference a removed hashed asset after a rebuild.
  // The build also ships these logos at stable paths.
  if (!image.dataset.logoRetried) {
    image.dataset.logoRetried = 'true';
    image.src = rootAsset(image.dataset.logoAsset, root);
    return;
  }
  const fallback = document.createElement('span');
  fallback.className = 'brand-image-fallback';
  fallback.textContent = image.alt === 'CNU' ? 'CNU' : 'GEH';
  fallback.setAttribute('role', 'img');
  fallback.setAttribute('aria-label', image.alt || 'GEH Lab');
  image.replaceWith(fallback);
}

export function refreshImageFallbacks(root = '.') {
  document.querySelectorAll('img[data-portrait-image], img[data-logo-asset]').forEach(image => {
    if (image.complete && !image.naturalWidth && !image.hidden) recoverImage(image, root);
  });
}

export function setupImageFallbacks(root = '.') {
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) recoverImage(event.target, root);
  }, true);
  refreshImageFallbacks(root);
}
