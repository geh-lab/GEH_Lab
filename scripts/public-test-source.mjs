import { readFile } from 'node:fs/promises';

// The browser and server share a page factory. Existing focused VM fixtures
// evaluate its lexical scope with fake DOM/data dependencies and expose only
// the functions under test; they must not evaluate the environment wrapper.
export async function getPublicPageSource() {
  const source = await readFile(new URL('../assets/js/public.js', import.meta.url), 'utf8');
  const startMarker = '/* PUBLIC_PAGE_SCOPE_START */';
  const endMarker = '/* PUBLIC_PAGE_SCOPE_END */';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 && end === -1) return source;
  if (start === -1 || end < start
    || source.indexOf(startMarker, start + startMarker.length) !== -1
    || source.indexOf(endMarker, end + endMarker.length) !== -1) {
    throw new Error('The shared public page must contain one ordered pair of test scope markers.');
  }
  const imports = source.slice(0, start).match(/^import\s+[\s\S]*?;\s*$/gm) || [];
  return `${imports.join('\n')}\n${source.slice(start + startMarker.length, end)}`;
}
