import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(projectRoot, 'firebase-config.js');
const outputPath = resolve(projectRoot, 'assets/data/profile-source.json');
const optional = process.argv.includes('--optional');

function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return '';
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function configValue(source, key) {
  return source.match(new RegExp(`${key}:\\s*["']([^"']+)["']`))?.[1] || '';
}

async function fetchCollection(projectId, apiKey, collectionName) {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}`);
    url.searchParams.set('pageSize', '300');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${collectionName}: ${response.status} ${response.statusText}`);
    const payload = await response.json();
    (payload.documents || []).forEach((document) => {
      const documentId = decodeURIComponent(document.name.split('/').pop() || '');
      const fields = decodeFirestoreFields(document.fields || {});
      items.push({ documentId, id: documentId, ...fields });
    });
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return items.filter((item) => item.deleted !== true);
}

async function main() {
  try {
    const configSource = await readFile(configPath, 'utf8');
    const projectId = configValue(configSource, 'projectId');
    const apiKey = configValue(configSource, 'apiKey');
    if (!projectId || !apiKey) throw new Error('firebase-config.js에서 projectId 또는 apiKey를 찾지 못했습니다.');

    const [members, projects, publications] = await Promise.all([
      fetchCollection(projectId, apiKey, 'members'),
      fetchCollection(projectId, apiKey, 'projects'),
      fetchCollection(projectId, apiKey, 'publications')
    ]);
    if (!members.length) throw new Error('공개 멤버 데이터가 비어 있습니다.');

    const snapshot = {
      generatedAt: new Date().toISOString(),
      source: `projects/${projectId}/databases/(default)`,
      members,
      projects,
      publications
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`Profile source synced: ${members.length} members, ${projects.length} projects, ${publications.length} publications.`);
  } catch (error) {
    if (optional) {
      console.warn(`Profile source sync skipped: ${error.message}`);
      return;
    }
    throw error;
  }
}

await main();
