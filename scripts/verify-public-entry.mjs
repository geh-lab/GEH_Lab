import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Import the real entry modules with offline dependency modules. This catches
// an entry becoming an inert factory while focused renderer tests still pass.
const bootstrap = await readFile(new URL('../assets/js/public.js', import.meta.url), 'utf8');
const alias = await readFile(new URL('../assets/js/public-entry.js', import.meta.url), 'utf8');
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const fixtureKey = '__gehPublicEntryFixture';
const rendererURL = moduleURL(`export function createPublicPage(environment) {
  const fixture = globalThis.${fixtureKey};
  fixture.calls.push(environment);
  return fixture.instance;
}`);
const chromeURL = moduleURL('export function setupPublicChrome() {}');
const firebaseURL = moduleURL('export const hasFirebaseConfig = true;');
const cacheURL = moduleURL("export const PUBLIC_DATA_CHANGED = 'public-data-changed';");
const cssURL = moduleURL('');

function replaceImport(source, specifier, replacement) {
  assert.equal(source.split(`'${specifier}'`).length - 1, 1, `Expected one import of ${specifier}`);
  return source.replace(`'${specifier}'`, JSON.stringify(replacement));
}

function entries(key) {
  let source = bootstrap;
  for (const [specifier, replacement] of [
    ['./public-renderer.js', rendererURL], ['./chrome.js', chromeURL],
    ['./firebase-public.js', firebaseURL], ['./public-data-cache.js', cacheURL],
    ['../css/icons.css', cssURL]
  ]) source = replaceImport(source, specifier, replacement);
  const legacyURL = moduleURL(`${source}\n// Entry fixture: ${key}`);
  const aliasURL = moduleURL(`${replaceImport(alias, './public.js', legacyURL)}\n// Alias fixture: ${key}`);
  return { legacyURL, aliasURL };
}

let checks = 0;
async function check(name, run, blockedStorage = false) {
  const originals = new Map(['window', 'document', fixtureKey].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = { getItem() { return null; } };
  const window = {};
  if (blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage is blocked'); } });
  else window.localStorage = storage;
  const fixture = { calls: [], instance: {} };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
    Object.defineProperty(globalThis, fixtureKey, { configurable: true, value: fixture });
    await run(entries(checks), fixture);
    assert.equal(fixture.calls.length, 1, 'Start the page exactly once');
    const environment = fixture.calls[0];
    assert.equal(environment.window, window);
    assert.equal(environment.document, globalThis.document);
    assert.equal(environment.localStorage, blockedStorage ? undefined : storage);
    assert.equal(typeof environment.setupPublicChrome, 'function');
    assert.equal(environment.firebaseApi.hasFirebaseConfig, true);
    assert.equal(environment.cacheApi.PUBLIC_DATA_CHANGED, 'public-data-changed');
    checks++;
    console.log(`PASS: ${name}`);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

await check('Legacy public.js initializes before the newer alias', async ({ legacyURL, aliasURL }, fixture) => {
  await import(legacyURL);
  assert.equal(fixture.calls.length, 1, 'The legacy entry must start without the newer entry');
  await import(aliasURL);
});
await check('New public-entry.js initializes before the legacy entry', async ({ legacyURL, aliasURL }, fixture) => {
  await import(aliasURL);
  assert.equal(fixture.calls.length, 1, 'The alias must start the page');
  await import(legacyURL);
});
await check('Different cached entry URLs do not initialize twice', async ({ legacyURL }) => {
  await import(legacyURL);
  await import(entries('different-version').legacyURL);
});
await check('Blocked browser storage does not prevent startup', async ({ aliasURL }) => {
  await import(aliasURL);
}, true);

console.log(`Public entry startup: ${checks} checks passed (legacy/new entry, duplicate URLs, optional storage).`);
