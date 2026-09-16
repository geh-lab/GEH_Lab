import { createPublicPage } from './public-renderer.js';
import { setupPublicChrome } from './chrome.js';
import * as firebaseApi from './firebase-public.js';
import * as cacheApi from './public-data-cache.js';
import '../css/icons.css';

// Keep this legacy entry self-starting for HTML already saved or deployed.
// Versioned entry URLs may coexist, so share the instance across module URLs.
const publicPageInstance = Symbol.for('geh.public.page.instance');
if (!window[publicPageInstance]) {
  let storage;
  try { storage = window.localStorage; } catch { /* Storage is optional. */ }
  window[publicPageInstance] = createPublicPage({
    document, window, localStorage: storage, setupPublicChrome, firebaseApi, cacheApi
  });
}
