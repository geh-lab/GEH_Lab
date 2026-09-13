const text = (value) => String(value ?? '').trim();

export function safePatentUrl(value = '') {
  try {
    const url = new URL(text(value));
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizePatent(item = {}) {
  const result = { ...item };
  for (const key of ['id', 'titleKr', 'titleEn', 'inventorsKr', 'inventorsEn', 'applicantKr', 'applicantEn',
    'countryKr', 'countryEn', 'applicationNumber', 'applicationDate', 'registrationNumber', 'registrationDate',
    'descriptionKr', 'descriptionEn']) result[key] = text(item[key]);
  result.titleKr ||= text(item.title);
  result.inventorsKr ||= text(item.inventors);
  result.status = item.status === 'granted' ? 'granted' : 'pending';
  result.url = safePatentUrl(item.url);
  result.sortOrder = Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 999;
  result.year = (result.status === 'granted' ? result.registrationDate : result.applicationDate).slice(0, 4);
  return result;
}

export function patentText(item, field, lang = 'kr') {
  return text(item[`${field}${lang === 'en' ? 'En' : 'Kr'}`])
    || text(item[`${field}${lang === 'en' ? 'Kr' : 'En'}`]) || text(item[field]);
}

export function patentStatusLabel(status, lang = 'kr') {
  return lang === 'en' ? (status === 'granted' ? 'Granted' : 'Filed') : (status === 'granted' ? '등록' : '출원');
}

export function sortPatents(items = []) {
  return items.map(normalizePatent).sort((a, b) => {
    const dateA = a.status === 'granted' ? a.registrationDate : a.applicationDate;
    const dateB = b.status === 'granted' ? b.registrationDate : b.applicationDate;
    return dateB.localeCompare(dateA) || a.sortOrder - b.sortOrder || patentText(a, 'title').localeCompare(patentText(b, 'title'), 'ko');
  });
}

export function filterPatents(items, query = '', status = 'all') {
  const needle = text(query).toLowerCase();
  return items.filter((item) => (status === 'all' || item.status === status) && (!needle || [
    item.titleKr, item.titleEn, item.inventorsKr, item.inventorsEn, item.applicantKr, item.applicantEn,
    item.countryKr, item.countryEn, item.applicationNumber, item.registrationNumber, item.applicationDate,
    item.registrationDate, item.year
  ].join(' ').toLowerCase().includes(needle)));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatePatent(item = {}) {
  if (!text(item.titleKr)) return '특허명(국문)을 입력해주세요.';
  if (!text(item.inventorsKr)) return '발명자(국문)를 입력해주세요.';
  if (!text(item.applicationNumber) || !validDate(text(item.applicationDate))) return '출원번호와 올바른 출원일을 입력해주세요.';
  if (!['pending', 'granted'].includes(item.status)) return '특허 상태를 확인해주세요.';
  if (item.status === 'granted') {
    if (!text(item.registrationNumber) || !validDate(text(item.registrationDate))) return '등록 특허는 등록번호와 등록일을 입력해주세요.';
    if (item.registrationDate < item.applicationDate) return '등록일은 출원일보다 빠를 수 없습니다.';
  }
  if (text(item.url) && !safePatentUrl(item.url)) return '특허 링크는 http:// 또는 https:// 주소를 입력해주세요.';
  return '';
}
