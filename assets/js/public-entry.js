import { createPublicPage } from './public.js';
import { setupPublicChrome } from './chrome.js';
import * as firebaseApi from './firebase-public.js';
import * as cacheApi from './public-data-cache.js';
import '../css/icons.css';

let storage;
try { storage = window.localStorage; } catch { /* Storage is optional. */ }
createPublicPage({ document, window, localStorage: storage, setupPublicChrome, firebaseApi, cacheApi });
