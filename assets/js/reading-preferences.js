export const TEXT_SIZES = [100, 125, 150, 175, 200];

export function normalizeTextSize(value) {
  const number = Number(value);
  return TEXT_SIZES.includes(number) ? number : 100;
}

export function nextTextSize(value, direction) {
  const index = TEXT_SIZES.indexOf(normalizeTextSize(value));
  return TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, index + Math.sign(direction)))];
}

export function setupReadingPreferences(panel) {
  const smaller = panel.querySelector('[data-text-smaller]');
  const larger = panel.querySelector('[data-text-larger]');
  const reset = panel.querySelector('[data-text-reset]');
  const value = panel.querySelector('[data-text-value]');
  if (!smaller || !larger || !reset || !value) return;
  let size = 100;
  try { size = normalizeTextSize(localStorage.getItem('geh-text-size')); } catch { /* Keep the control usable without storage. */ }
  const apply = (next, persist = false) => {
    size = normalizeTextSize(next);
    document.documentElement.dataset.textSize = String(size);
    document.documentElement.style.setProperty('--reading-scale', String(size / 100));
    value.textContent = `${size}%`;
    smaller.disabled = size === TEXT_SIZES[0];
    larger.disabled = size === TEXT_SIZES.at(-1);
    reset.disabled = size === 100;
    if (persist) {
      try { localStorage.setItem('geh-text-size', String(size)); } catch { /* The current page still updates. */ }
    }
  };
  smaller.addEventListener('click', () => apply(nextTextSize(size, -1), true));
  larger.addEventListener('click', () => apply(nextTextSize(size, 1), true));
  reset.addEventListener('click', () => apply(100, true));
  window.addEventListener('storage', event => {
    if (event.key === 'geh-text-size' || event.key === null) apply(event.newValue);
  });
  apply(size);
}
