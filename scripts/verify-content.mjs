import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localizedInvestigatorName, resolveProjectInvestigator } from '../assets/js/project-investigator.js';
import { normalizeProject, normalizeMember, sortMembers, memberTotalSemesters } from '../assets/js/utils.js';
import { allowsAdminPreview } from '../assets/js/admin-preview.js';
import { memberSummary } from '../assets/js/member-summary.js';
import { normalizeTextSize, nextTextSize } from '../assets/js/reading-preferences.js';
import { GLASS_SURFACE, GLASS_CONTROL, surfaceOptics, createSurfaceMaps } from '../assets/js/glass-surface-model.js';
import { normalizePatent, sortPatents, filterPatents, patentText, validatePatent, safePatentUrl } from '../assets/js/patents.js';
import { getPublicPageSource } from './public-test-source.mjs';

const members = [
  { id: 'park', nameKr: '박종석', nameEn: 'Jongseok Park' },
  { id: 'lee', nameKr: '이광야', nameEn: 'Kwangya Lee' }
];
for (const member of members) {
  for (const storedName of [member.nameKr, member.nameEn]) {
    const project = normalizeProject({ title: 'Legacy project', principalInvestigator: storedName });
    assert.equal(localizedInvestigatorName(project, members, 'kr'), member.nameKr);
    assert.equal(localizedInvestigatorName(project, members, 'en'), member.nameEn);
  }
}
assert.equal(resolveProjectInvestigator({ principalInvestigatorId: 'lee', principalInvestigator: '박종석' }, members).id, 'lee');
assert.equal(localizedInvestigatorName({ principalInvestigator: 'Guest researcher' }, members, 'en'), 'Guest researcher');
const snapshot = normalizeProject({ principalInvestigatorKr: '박종석', principalInvestigatorEn: 'Jongseok Park' });
assert.equal(localizedInvestigatorName(snapshot, [], 'kr'), '박종석');
assert.equal(localizedInvestigatorName(snapshot, [], 'en'), 'Jongseok Park');
const publicSource = await getPublicPageSource();
assert.match(publicSource, /projects: \[COLLECTIONS.projects, COLLECTIONS.members\]/);
assert.match(publicSource, /projects: new Set\(\['projects', 'members'\]\)/);

const pending = { id: 'test-pending', titleKr: '테스트 특허', titleEn: 'Test patent', inventorsKr: '박종석', inventorsEn: 'Jongseok Park', applicationNumber: '10-2025-0000000', applicationDate: '2025-08-01', status: 'pending' };
const granted = { ...pending, id: 'test-granted', status: 'granted', registrationNumber: '10-0000000', registrationDate: '2026-08-01' };
assert.equal(validatePatent(pending), '');
assert.equal(validatePatent(granted), '');
assert.ok(validatePatent({ ...granted, registrationNumber: '' }));
assert.ok(validatePatent({ ...granted, registrationDate: '2024-01-01' }));
assert.ok(validatePatent({ ...pending, applicationDate: '2025-02-30' }));
assert.ok(validatePatent({ ...pending, url: 'javascript:alert(1)' }));
assert.equal(safePatentUrl('https://example.com/patent'), 'https://example.com/patent');
assert.equal(safePatentUrl('data:text/html,unsafe'), '');
assert.equal(normalizePatent(granted).year, '2026');
assert.equal(normalizePatent({ ...granted, status: 'pending' }).year, '2025');
assert.equal(patentText(granted, 'title', 'en'), 'Test patent');
assert.equal(patentText({ titleKr: '국문만 있음' }, 'title', 'en'), '국문만 있음');
assert.deepEqual(sortPatents([pending, granted]).map((item) => item.id), ['test-granted', 'test-pending']);
assert.deepEqual(filterPatents([pending, granted], 'Jongseok', 'granted').map((item) => item.id), ['test-granted']);
assert.equal(filterPatents([pending, granted], 'no result').length, 0);
assert.equal(filterPatents([pending, granted], '10-2025-0000000').length, 2);
console.log('Content regression checks passed: bilingual legacy names, identity precedence, saved names, patent dates, status, search, sorting and safe URLs.');

for (const prefix of ['', 'en/']) {
  for (const name of ['index', 'members', 'projects', 'publications', 'patents', 'news', 'board', 'contact']) {
    const html = await readFile(new URL(`../${prefix}${name}.html`, import.meta.url), 'utf8');
    assert.equal((html.match(/data-nav-page="patents"/g) || []).length, 1, `Patent nav missing or duplicated in ${prefix}${name}`);
  }
  const html = await readFile(new URL(`../${prefix}patents.html`, import.meta.url), 'utf8');
  assert.ok(html.includes(`rel="canonical" href="https://geh-lab.vercel.app/${prefix}patents.html"`));
}
console.log('Navigation checks passed: 16 public pages and both patent canonical URLs.');

const fall2026 = new Date(2026, 8, 13);
const student = { status: 'enrolled', group: 'graduateStudent', course: 'phd', track: 'fullTime', startYear: '2026' };
const entrants = [
  { ...student, id: 'vu', nameKr: '부키안', startSemester: '2' },
  { ...student, id: 'yi', nameKr: '이원규', startSemester: '1' },
  { ...student, id: 'kim', nameKr: '김병준', startSemester: '1' }
];
assert.deepEqual(sortMembers(entrants, fall2026).map(item => item.id), ['kim', 'yi', 'vu']);
assert.equal(memberTotalSemesters(entrants[0], fall2026), 1);
assert.equal(memberTotalSemesters(entrants[1], fall2026), 2);
assert.equal(memberTotalSemesters(entrants[1], new Date(2027, 1, 1)), 2, 'January/February belong to the previous fall term');
assert.equal(memberTotalSemesters(entrants[1], new Date(2027, 2, 1)), 3);
assert.equal(memberTotalSemesters({ ...student, startSemester: '' }, fall2026), 0);
assert.equal(memberTotalSemesters({ ...entrants[1], status: 'alumni' }, fall2026), 0);

for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
  assert.equal(allowsAdminPreview({ hostname, pathname: '/admin.html', search: '?preview=1' }), true);
  assert.equal(allowsAdminPreview({ hostname, pathname: '/admin.html', search: '' }), false);
  assert.equal(allowsAdminPreview({ hostname, pathname: '/members.html', search: '?preview=1' }), false);
}
for (const hostname of ['geh-lab.vercel.app', 'localhost.example.com', '127.0.0.1.example.com', '192.168.0.1', '']) {
  assert.equal(allowsAdminPreview({ hostname, pathname: '/admin.html', search: '?preview=1' }), false);
}
const summaryMembers = [...entrants,
  { id: 'pi', group: 'pi', status: 'enrolled', course: 'professor' },
  { id: 'postdoc', group: 'researchProfessor', status: 'enrolled', course: 'postdoc' },
  { id: 'undergrad', group: 'studentResearcher', status: 'enrolled', course: 'undergrad' },
  { id: 'alumnus', group: 'alumni', status: 'alumni', course: 'ms' }
].map(normalizeMember);
for (const lang of ['kr', 'en']) {
  const summary = memberSummary(summaryMembers, lang);
  assert.deepEqual(summary.stats.map(item => item.value), [2, 3, 1, 1]);
}
console.log('Follow-up checks passed: semester order and academic boundaries, non-overlapping member counts, and localhost-only admin preview.');

// Stored preferences cannot inject arbitrary sizing; increments stop at both ends.
for (const value of [null, '', 'bogus', '125px', -100, 0, 101, 300, Infinity]) {
  assert.equal(normalizeTextSize(value), 100);
}
assert.equal(normalizeTextSize('175'), 175);
assert.equal(nextTextSize(100, -1), 100);
assert.equal(nextTextSize(200, 1), 200);
assert.equal(nextTextSize(125, 1), 150);
assert.equal(nextTextSize(150, -1), 125);
assert.equal(nextTextSize('invalid', 1), 125);
console.log('Reading preference checks passed: stored values, increments, and size limits.');

const trackMembers = [
  { group:'graduateStudent', status:'enrolled', course:'phd', track:'fullTime' },
  { group:'graduateStudent', status:'enrolled', course:'ms', track:'partTime' },
  { group:'graduateStudent', status:'enrolled', course:'phd' },
  { group:'graduateStudent', status:'alumni', course:'ms', track:'partTime' }
];
assert.equal(memberSummary(trackMembers, 'kr').stats[1].detail, '풀타임 1 (박사 1 · 석사 0)\n파트타임 1 (박사 0 · 석사 1)\n미지정 1 (박사 1 · 석사 0)');
assert.equal(memberSummary(trackMembers, 'en').stats[1].detail, 'Full-time 1 (Ph.D. 1 · M.S. 0)\nPart-time 1 (Ph.D. 0 · M.S. 1)\nUnspecified 1 (Ph.D. 1 · M.S. 0)');
assert.equal(memberSummary([], 'kr').stats[1].detail, '풀타임 0 (박사 0 · 석사 0)\n파트타임 0 (박사 0 · 석사 0)');
const mixedTrackMembers = [...trackMembers,
  { group:'graduateStudent', status:'enrolled', course:'masters', track:'fullTime' },
  { group:'graduateStudent', status:'enrolled', course:'doctoral', track:'partTime' },
  { group:'graduateStudent', status:'enrolled', course:'phdCompleted', track:'fullTime' },
  { group:'graduateStudent', status:'enrolled', track:'fullTime' },
  { group:'researchProfessor', status:'enrolled', course:'phd', track:'fullTime' },
  { group:'studentResearcher', status:'enrolled', course:'undergrad', track:'fullTime' }
];
assert.equal(memberSummary(mixedTrackMembers, 'kr').stats[1].value, 7);
assert.equal(memberSummary(mixedTrackMembers, 'kr').stats[1].detail, '풀타임 4 (박사 2 · 석사 1 · 학위 미지정 1)\n파트타임 2 (박사 1 · 석사 1)\n미지정 1 (박사 1 · 석사 0)');

// Full panels, pills, and circles have no hollow centre. Their exterior stays
// untouched, and the default sampling field must not fold along either axis.
for(const [width,height,radius,options={}] of [[360,200,30],[180,180,90],[420,54,27],[128,48,24,GLASS_CONTROL],[154,52,26,GLASS_CONTROL],[620,52,26,GLASS_CONTROL]]) {
  assert.equal(surfaceOptics(width/2,height/2,width,height,radius,options).mask,1);
  assert.ok(Math.abs(surfaceOptics(width*.6,height/2,width,height,radius,options).dx)>0,'The interior should magnify, not only the perimeter');
  for(const [x,y] of [[0,0],[-1,height/2],[width+1,height/2],[width/2,-1],[width/2,height+1]]) {
    const value=surfaceOptics(x,y,width,height,radius,options);
    assert.equal(value.mask,0);assert.equal(value.dx,0);assert.equal(value.dy,0);
  }
  for(const axis of ['x','y']) {
    const length=axis==='x'?width:height;
    for(let p=length/2;p<length-1;p+=.25) {
      const sample=delta=>surfaceOptics(axis==='x'?p+delta:width/2,axis==='y'?p+delta:height/2,width,height,radius,options);
      assert.ok(1+(sample(.001)[axis==='x'?'dx':'dy']-sample(-.001)[axis==='x'?'dx':'dy'])/.002>0,'The lens must not fold grid lines');
    }
  }
  if(options===GLASS_CONTROL)assert.ok(Math.abs(surfaceOptics(width*.65,height/2,width,height,radius,options).dx)>1,'Short header lenses must visibly magnify their backdrop');
  const maps=createSurfaceMaps(width,height,radius,options);
  assert.ok(maps.width<=480&&maps.height<=480);
  for(let y=0;y<maps.height;y++) for(let x=0;x<maps.width;x++) {
    const value=surfaceOptics((x+.5)*width/maps.width,(y+.5)*height/maps.height,width,height,radius,options);
    const i=(y*maps.width+x)*4;
    if(value.distance<=0)assert.equal(maps.mask[i+3],0);
    assert.ok(Math.abs(value.dx)<GLASS_SURFACE.scale/2&&Math.abs(value.dy)<GLASS_SURFACE.scale/2,'The displacement map must not clip');
  }
}
console.log('Glass and summary checks passed: track counts, full-surface transmission, exterior masks, bounded maps, and unfolded sampling.');
