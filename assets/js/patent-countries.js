// Region codes: Unicode CLDR regular regions, checked 2026-09-14.
// https://github.com/unicode-org/cldr/blob/main/common/validity/region.xml
// Labels come from the browser's CLDR-backed Intl.DisplayNames, without a network request.
const REGION_CODES = `
AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH
BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM
CN CO CP CQ CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER
ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT
GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC
MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE
NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV
SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US
UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW
`.trim().split(/\s+/);

export const DEFAULT_PATENT_COUNTRY_CODE = 'KR';

// Editorial order for the admin menu; the remaining regions are sorted in Korean.
const MAJOR_CODES = ['KR', 'US', 'CN', 'JP', 'DE', 'GB', 'FR', 'CA', 'AU', 'IN', 'TW', 'SG'];
const LABEL_OVERRIDES = {
  KR: ['대한민국', 'Republic of Korea'],
  US: ['미국', 'United States'],
  CN: ['중국', 'China'],
  JP: ['일본', 'Japan'],
  DE: ['독일', 'Germany'],
  GB: ['영국', 'United Kingdom'],
  FR: ['프랑스', 'France'],
  CA: ['캐나다', 'Canada'],
  AU: ['오스트레일리아', 'Australia'],
  IN: ['인도', 'India'],
  TW: ['대만', 'Taiwan'],
  SG: ['싱가포르', 'Singapore'],
  CQ: ['사크섬', 'Sark'],
};

const EXTRA_JURISDICTIONS = [
  { code: 'EP', countryKr: '유럽특허청 (EPO)', countryEn: 'European Patent Office (EPO)', group: 'jurisdiction' },
  { code: 'WO', countryKr: '국제출원 (PCT)', countryEn: 'International application (PCT)', group: 'jurisdiction' },
];

function displayNames(locale) {
  try { return new Intl.DisplayNames([locale], { type: 'region' }); } catch { return null; }
}

const koreanNames = displayNames('ko');
const englishNames = displayNames('en');
const koreanOrder = new Intl.Collator('ko');
const majorCodes = new Set(MAJOR_CODES);

function regionOption(code) {
  const override = LABEL_OVERRIDES[code];
  return {
    code,
    countryKr: override?.[0] || koreanNames?.of(code) || code,
    countryEn: override?.[1] || englishNames?.of(code) || code,
    group: majorCodes.has(code) ? 'major' : 'other',
  };
}

/** Immutable options: Korea first, major countries, Korean alphabetical regions, other patent jurisdictions. */
export const PATENT_COUNTRIES = Object.freeze([
  ...MAJOR_CODES.map(regionOption),
  ...REGION_CODES.filter((code) => !majorCodes.has(code)).map(regionOption)
    .sort((a, b) => koreanOrder.compare(a.countryKr, b.countryKr) || a.code.localeCompare(b.code)),
  ...EXTRA_JURISDICTIONS,
].map((option) => Object.freeze(option)));

const byCode = new Map(PATENT_COUNTRIES.map((option) => [option.code, option]));
const aliasIndex = new Map();
const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s.,()_-]+/g, '');

function addAlias(code, name) {
  const key = normalize(name);
  if (!key) return;
  const previous = aliasIndex.get(key);
  // Do not infer a jurisdiction from a genuinely ambiguous name.
  if (previous !== undefined && previous !== code) aliasIndex.set(key, null);
  else aliasIndex.set(key, code);
}

for (const option of PATENT_COUNTRIES) {
  const displayAliases = option.group === 'jurisdiction' ? []
    : [koreanNames?.of(option.code), englishNames?.of(option.code)];
  for (const alias of [option.code, option.countryKr, option.countryEn, ...displayAliases]) addAlias(option.code, alias);
}

const EXTRA_ALIASES = {
  KR: ['한국', '남한', 'South Korea', 'Korea, Republic of', 'ROK'],
  US: ['미합중국', 'United States of America', 'USA', 'U.S.'],
  GB: ['UK', 'U.K.', 'United Kingdom of Great Britain and Northern Ireland'],
  CN: ['중화인민공화국', 'People’s Republic of China', "People's Republic of China", 'PR China', 'PRC'],
  AU: ['호주'],
  RU: ['Russian Federation'],
  EP: ['EPO', '유럽특허청', '유럽특허', 'European Patent Office'],
  WO: ['PCT', 'WIPO', 'PCT 국제출원', '국제출원', 'International application', 'PCT international application'],
};
for (const [code, names] of Object.entries(EXTRA_ALIASES)) {
  for (const name of names) addAlias(code, name);
}

function legacyOption(record) {
  return Object.freeze({
    code: 'legacy',
    countryKr: String(record?.countryKr ?? ''),
    countryEn: String(record?.countryEn ?? ''),
    group: 'legacy',
    legacy: true,
  });
}

/** No argument selects Korea for a new record. Existing unknown/conflicting/blank pairs remain exact legacy values. */
export function resolvePatentCountry(record) {
  if (record == null) return byCode.get(DEFAULT_PATENT_COUNTRY_CODE);
  const values = [record.countryKr, record.countryEn].filter((value) => normalize(value));
  const codes = values.map((value) => aliasIndex.get(normalize(value)));
  if (codes.length && codes.every((code) => code && code === codes[0])) return byCode.get(codes[0]);
  return legacyOption(record);
}

/** The legacy option is scoped to the edited record and must be escaped like other option labels by the caller. */
export function patentCountryOptions(record) {
  const current = resolvePatentCountry(record);
  return current.legacy ? [...PATENT_COUNTRIES, current] : [...PATENT_COUNTRIES];
}

/** Resolve a dropdown's code to fields saved by the existing patent schema. Unknown selections cannot erase existing text. */
export function patentCountryFields(code, record) {
  const current = byCode.get(String(code)) || resolvePatentCountry(record);
  return { countryKr: current.countryKr, countryEn: current.countryEn };
}
