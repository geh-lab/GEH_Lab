import assert from 'node:assert/strict';
import { DEFAULT_PATENT_COUNTRY_CODE, PATENT_COUNTRIES, resolvePatentCountry,
  patentCountryOptions, patentCountryFields } from '../assets/js/patent-countries.js';

let checks = 0;
function check(name, run) { run(); checks += 1; console.log(`✓ ${name}`); }

check('new patents default to Korea with the requested English name', () => {
  assert.equal(DEFAULT_PATENT_COUNTRY_CODE, 'KR');
  assert.equal(PATENT_COUNTRIES[0].code, 'KR');
  assert.deepEqual(patentCountryFields(resolvePatentCountry().code), {
    countryKr: '대한민국', countryEn: 'Republic of Korea',
  });
});

check('major countries precede all other regions, which follow Korean 가나다 order', () => {
  const major = PATENT_COUNTRIES.filter((option) => option.group === 'major');
  assert.deepEqual(major.slice(0, 4).map((option) => option.code), ['KR', 'US', 'CN', 'JP']);
  assert.deepEqual(PATENT_COUNTRIES.slice(0, major.length), major);
  const other = PATENT_COUNTRIES.filter((option) => option.group === 'other');
  assert.ok(other.length > 200);
  assert.deepEqual(other, [...other].sort((a, b) => a.countryKr.localeCompare(b.countryKr, 'ko') || a.code.localeCompare(b.code)));
});

check('the catalog has unique codes and bilingual labels including long or less common region names', () => {
  assert.equal(PATENT_COUNTRIES.length, 259);
  assert.equal(new Set(PATENT_COUNTRIES.map((option) => option.code)).size, PATENT_COUNTRIES.length);
  for (const option of PATENT_COUNTRIES) {
    assert.ok(option.countryKr && option.countryEn, option.code);
    assert.notEqual(option.countryKr, option.code, option.code);
    assert.notEqual(option.countryEn, option.code, option.code);
  }
  assert.ok(PATENT_COUNTRIES.some((option) => option.code === 'GH'), 'Ghana is present');
  assert.ok(PATENT_COUNTRIES.some((option) => option.code === 'CQ'), 'Sark has labels for older CLDR runtimes');
});

check('selecting any jurisdiction yields synchronized Korean and English saved fields', () => {
  for (const option of PATENT_COUNTRIES) {
    assert.deepEqual(patentCountryFields(option.code), { countryKr: option.countryKr, countryEn: option.countryEn });
    assert.equal(resolvePatentCountry(patentCountryFields(option.code)).code, option.code);
  }
});

check('existing Korea, United States and Australia aliases resolve without duplicate options', () => {
  assert.equal(resolvePatentCountry({ countryKr: '한국', countryEn: 'Korea, Republic of' }).code, 'KR');
  assert.equal(resolvePatentCountry({ countryKr: 'KR', countryEn: 'South Korea' }).code, 'KR');
  assert.equal(resolvePatentCountry({ countryKr: '미국', countryEn: 'U.S.A.' }).code, 'US');
  assert.equal(resolvePatentCountry({ countryKr: '호주', countryEn: 'Australia' }).code, 'AU');
  assert.equal(patentCountryOptions({ countryKr: '한국' }).length, PATENT_COUNTRIES.length);
});

check('a recognized existing country fills a missing translation', () => {
  const current = resolvePatentCountry({ countryKr: '독일', countryEn: '' });
  assert.deepEqual(patentCountryFields(current.code), { countryKr: '독일', countryEn: 'Germany' });
  assert.equal(resolvePatentCountry({ countryEn: 'United Kingdom' }).code, 'GB');
});

check('regional and international filing routes are separate from country options', () => {
  assert.equal(resolvePatentCountry({ countryKr: '유럽특허청', countryEn: 'EPO' }).code, 'EP');
  assert.equal(resolvePatentCountry({ countryKr: 'PCT 국제출원', countryEn: 'WIPO' }).code, 'WO');
  assert.ok(PATENT_COUNTRIES.filter((option) => option.group === 'jurisdiction').every((option) => ['EP', 'WO'].includes(option.code)));
});

check('unknown existing values are retained exactly and scoped to that record only', () => {
  const existing = { countryKr: ' 특별 관할 <기존값> ', countryEn: 'Previously entered jurisdiction' };
  const option = resolvePatentCountry(existing);
  assert.equal(option.legacy, true);
  assert.equal(option.countryKr, existing.countryKr);
  assert.deepEqual(patentCountryFields(option.code, existing), existing);
  assert.deepEqual(patentCountryOptions(existing).at(-1), option);
  assert.equal(patentCountryOptions().some((item) => item.legacy), false);
});

check('conflicting or partly unknown bilingual pairs are not guessed or overwritten', () => {
  for (const existing of [
    { countryKr: '미국', countryEn: 'Japan' },
    { countryKr: '대한민국', countryEn: 'Custom legal jurisdiction' },
    { countryKr: '알 수 없는 관할', countryEn: 'United States' },
  ]) {
    assert.equal(resolvePatentCountry(existing).legacy, true);
    assert.deepEqual(patentCountryFields('legacy', existing), existing);
  }
});

check('blank existing fields stay blank, while changing the selection replaces them intentionally', () => {
  const existing = { countryKr: '', countryEn: '' };
  assert.equal(resolvePatentCountry(existing).legacy, true);
  assert.deepEqual(patentCountryFields('legacy', existing), existing);
  assert.deepEqual(patentCountryFields('JP', existing), { countryKr: '일본', countryEn: 'Japan' });
});

check('invalid selection tokens cannot erase existing data or mutate the catalog', () => {
  const existing = { countryKr: '옛 관할', countryEn: 'Legacy region' };
  assert.deepEqual(patentCountryFields('invalid', existing), existing);
  assert.ok(Object.isFrozen(PATENT_COUNTRIES));
  assert.ok(PATENT_COUNTRIES.every(Object.isFrozen));
});

console.log(`Patent country verification passed (${checks} checks).`);
