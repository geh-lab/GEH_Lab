import assert from 'node:assert/strict';
import { buildPatentInventorFields, patentInventorDisplay, patentsForMember, resolvePatentInventors } from '../assets/js/patent-inventors.js';
import { normalizePatent } from '../assets/js/patents.js';

const park = { id: 'park', nameKr: '박종석', nameEn: 'Jongseok Park' };
const ham = { id: 'ham', nameKr: '함승용', nameEn: 'Seungyong Ham' };
const members = [park, ham];
let checks = 0;
function check(name, run) { run(); checks += 1; console.log(`✓ ${name}`); }

check('legacy names link exact unique members and retain outside inventors in both languages', () => {
  const result = resolvePatentInventors({ inventorsKr: '박종석, 함승용; 외부 연구자\n김외부', inventorsEn: 'Jongseok Park, Seungyong Ham; Jane Doe' }, members);
  assert.deepEqual(result.memberIds, ['park', 'ham']);
  assert.equal(result.externalInventorsKr, '외부 연구자, 김외부');
  assert.equal(result.externalInventorsEn, 'Jane Doe');
  assert.equal(result.legacy, true);
});

check('normalization does not turn legacy names into explicit empty links', () => {
  const item = normalizePatent({ inventorsKr: '박종석' });
  assert.equal(Object.hasOwn(item, 'inventorMemberIds'), false);
  assert.deepEqual(resolvePatentInventors(item, members).memberIds, ['park']);
});

check('a substring or ambiguous homonym never auto-links', () => {
  const result = resolvePatentInventors({ inventorsKr: '박종석 연구원, 김민수' }, [...members,
    { id: 'kim1', nameKr: '김민수' }, { id: 'kim2', nameKr: '김민수' }]);
  assert.deepEqual(result.memberIds, []);
  assert.equal(result.externalInventorsKr, '박종석 연구원, 김민수');
});

check('legacy comma-formatted English names match as whole names', () => {
  const result = resolvePatentInventors({ inventorsEn: 'Park, Jongseok, Jane Doe' }, [{ ...park, nameEn: 'Park, Jongseok' }]);
  assert.deepEqual(result.memberIds, ['park']);
  assert.equal(result.externalInventorsEn, 'Jane Doe');
});

check('an explicit empty list remains unlinked despite matching display names', () => {
  const item = { inventorMemberIds: [], inventorsKr: '박종석' };
  assert.deepEqual(resolvePatentInventors(item, members).memberIds, []);
  assert.equal(resolvePatentInventors(item, members).externalInventorsKr, '박종석');
  assert.deepEqual(patentsForMember([item], park, members), []);
});

check('legacy content stays editable when the roster is unavailable', () => {
  const result = resolvePatentInventors({ inventorsKr: '박종석, 함승용', inventorsEn: 'Jongseok Park, Seungyong Ham' });
  assert.equal(result.externalInventorsKr, '박종석, 함승용');
  assert.equal(result.externalInventorsEn, 'Jongseok Park, Seungyong Ham');
  assert.deepEqual(result.memberIds, []);
});

check('composed display names contain no repeated selected members or external names', () => {
  const result = buildPatentInventorFields({ memberIds: ['park', 'park', 'ham'], externalInventorsKr: '박종석, 김외부, 김외부', externalInventorsEn: 'Jongseok Park; Jane Doe; Jane Doe' }, members);
  assert.deepEqual(result.inventorMemberIds, ['park', 'ham']);
  assert.equal(result.inventorsKr, '박종석, 함승용, 김외부');
  assert.equal(result.inventorsEn, 'Jongseok Park, Seungyong Ham, Jane Doe');
});

check('a stable ID keeps the association after a member is renamed', () => {
  const previous = buildPatentInventorFields({ memberIds: ['park'] }, members);
  const renamed = { ...park, nameKr: '박새이름', nameEn: 'New Name Park' };
  const result = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '박종석' }, [renamed, ham], previous);
  assert.equal(result.inventorsKr, '박새이름');
  assert.equal(result.inventorMembers[0].nameEn, 'New Name Park');
  assert.equal(patentsForMember([{ id: 'p', ...previous }], renamed, [renamed, ham]).length, 1);
});

check('selected missing or deleted members retain saved bilingual snapshots', () => {
  const previous = buildPatentInventorFields({ memberIds: ['park', 'ham'], externalInventorsKr: '김외부', externalInventorsEn: 'Jane Doe' }, members);
  const result = buildPatentInventorFields({ memberIds: ['ham'], externalInventorsKr: '김외부', externalInventorsEn: 'Jane Doe' }, [park, { ...ham, deleted: true }], previous);
  assert.equal(result.inventorsKr, '함승용, 김외부');
  assert.equal(result.inventorsEn, 'Seungyong Ham, Jane Doe');
  assert.deepEqual(result.inventorMembers, [previous.inventorMembers[1]]);
});

check('external-only inventors remain external even when their names match a lab member', () => {
  const result = buildPatentInventorFields({ memberIds: [], externalInventorsKr: '박종석, 김외부', externalInventorsEn: 'Jongseok Park, Jane Doe' }, members);
  assert.equal(result.inventorsKr, '박종석, 김외부');
  assert.deepEqual(resolvePatentInventors(result, members).memberIds, []);
});

check('ambiguous external comma-formatted English names retain repeated surnames', () => {
  const result = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '외부 발명자', externalInventorsEn: 'Doe, Jane, Doe, John' }, members);
  assert.equal(result.inventorsEn, 'Jongseok Park, Doe, Jane, Doe, John');
});

check('unchecking all members preserves only explicitly entered external inventors', () => {
  const previous = buildPatentInventorFields({ memberIds: ['park', 'ham'] }, members);
  const result = buildPatentInventorFields({ memberIds: [], externalInventorsKr: '김외부', externalInventorsEn: '' }, members, previous);
  assert.deepEqual(result.inventorMembers, []);
  assert.equal(result.inventorsKr, '김외부');
  assert.equal(result.inventorsEn, '김외부');
});

check('English-only member records still compose a usable Korean display field', () => {
  const result = buildPatentInventorFields({ memberIds: ['external-student'] }, [{ id: 'external-student', nameEn: 'Jane Smith' }]);
  assert.equal(result.inventorsKr, 'Jane Smith');
  assert.equal(result.inventorsEn, 'Jane Smith');
});

check('member patents exclude deleted records and sort granted and pending by their relevant date', () => {
  const link = buildPatentInventorFields({ memberIds: ['ham'] }, members);
  const result = patentsForMember([
    { id: 'old', ...link, status: 'pending', applicationNumber: '10-2020-1', applicationDate: '2020-01-01' },
    { id: 'grant', ...link, status: 'granted', applicationNumber: '10-2022-1', applicationDate: '2022-01-01', registrationDate: '2026-01-01' },
    { id: 'pending', ...link, status: 'pending', applicationNumber: '10-2025-1', applicationDate: '2025-01-01' },
    { id: 'removed', ...link, deleted: true, status: 'granted', registrationDate: '2027-01-01' }
  ], ham, members);
  assert.deepEqual(result.map((item) => item.id), ['grant', 'pending', 'old']);
  assert.equal(result.filter((item) => item.status === 'granted').length, 1);
  assert.equal(result.filter((item) => item.status === 'pending').length, 2);
});

check('duplicate documents for the same application count once', () => {
  const link = buildPatentInventorFields({ memberIds: ['ham'] }, members);
  const first = { id: 'first', ...link, applicationNumber: '10-2022-0001', applicationDate: '2022-01-01', status: 'pending' };
  const granted = { ...first, id: 'duplicate', applicationNumber: '1020220001', registrationDate: '2025-01-01', status: 'granted' };
  const result = patentsForMember([first, granted, granted], ham, members);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'granted');
  assert.equal(patentsForMember([first, { ...first, applicationNumber: '99' }], ham, members).length, 1);
});

check('a deleted member cannot receive new legacy matches or profile counts', () => {
  const deleted = { ...ham, deleted: true };
  assert.deepEqual(resolvePatentInventors({ inventorsKr: '함승용' }, [deleted]).memberIds, []);
  assert.deepEqual(patentsForMember([{ inventorMemberIds: ['ham'] }], deleted, [deleted]), []);
});

check('English display localizes legacy Korean names, including a Korean English-field fallback', () => {
  const item = { inventorsKr: '박종석, 함승용, 김외부' };
  assert.equal(patentInventorDisplay(item, members, 'en'), 'Jongseok Park, Seungyong Ham, 김외부');
  assert.equal(patentInventorDisplay({ ...item, inventorsEn: item.inventorsKr }, members, 'en'), 'Jongseok Park, Seungyong Ham, 김외부');
  assert.equal(patentInventorDisplay(item, members, 'kr'), item.inventorsKr);
});

check('localized legacy names retain outside English names and original inventor order', () => {
  const item = { inventorsKr: '박종석, 김외부, 함승용', inventorsEn: '박종석, Jane Doe, 함승용' };
  assert.equal(patentInventorDisplay(item, members, 'en'), 'Jongseok Park, Jane Doe, Seungyong Ham');
  // An older English field may have contained only the manually entered name.
  assert.equal(patentInventorDisplay({ ...item, inventorsEn: 'Jane Doe' }, members, 'en'), 'Jongseok Park, Jane Doe, Seungyong Ham');
});

check('structured display uses current member names while recognizing saved spellings', () => {
  const item = buildPatentInventorFields({ memberIds: ['park', 'ham'], externalInventorsKr: '김외부', externalInventorsEn: 'Jane Doe' }, members);
  const renamed = { ...park, nameKr: '박새이름', nameEn: 'New Name Park' };
  assert.equal(patentInventorDisplay(item, [renamed, ham], 'en'), 'New Name Park, Seungyong Ham, Jane Doe');
  assert.equal(patentInventorDisplay(item, [renamed, ham], 'kr'), '박새이름, 함승용, 김외부');
  assert.equal(item.inventorsEn, 'Jongseok Park, Seungyong Ham, Jane Doe');
});

check('structured display prefers the external English field when the full English display is stale', () => {
  const item = {
    ...buildPatentInventorFields({ memberIds: ['park', 'ham'], externalInventorsKr: '김외부', externalInventorsEn: 'Jane Doe' }, members),
    inventorsKr: '박종석, 김외부, 함승용', inventorsEn: '박종석, 김외부, 함승용'
  };
  delete item.inventorOrder; // This is an older structured record, before explicit ordering.
  assert.equal(patentInventorDisplay(item, members, 'en'), 'Jongseok Park, Jane Doe, Seungyong Ham');
});

check('English display honors explicit unlink and does not translate unselected external members', () => {
  assert.equal(patentInventorDisplay({ inventorMemberIds: [], inventorsKr: '박종석' }, members, 'en'), '박종석');
  const item = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '함승용', externalInventorsEn: '' }, members);
  assert.equal(patentInventorDisplay(item, members, 'en'), 'Jongseok Park, 함승용');
  assert.equal(patentInventorDisplay({ inventorMemberIds: [], externalInventorsKr: '', externalInventorsEn: '', inventorsKr: '박종석' }, members, 'en'), '');
});

check('English display never infers names from ambiguous matches or partial names', () => {
  const roster = [...members, { id: 'kim1', nameKr: '김민수', nameEn: 'Minsu Kim' }, { id: 'kim2', nameKr: '김민수', nameEn: 'Minsoo Kim' }];
  assert.equal(patentInventorDisplay({ inventorsKr: '김민수, 박종석 연구원' }, roster, 'en'), '김민수, 박종석 연구원');
});

check('display retains stored snapshots when members are absent or deleted', () => {
  const item = buildPatentInventorFields({ memberIds: ['park', 'ham'] }, members);
  assert.equal(patentInventorDisplay(item, [], 'en'), 'Jongseok Park, Seungyong Ham');
  assert.equal(patentInventorDisplay(item, [{ ...park, deleted: true }, ham], 'en'), 'Jongseok Park, Seungyong Ham');
  assert.equal(patentInventorDisplay({ inventorMemberIds: ['park'], inventorsKr: '박종석', externalInventorsKr: '', externalInventorsEn: '' }, [], 'en'), '박종석');
});

check('display uses Korean fallback rather than inventing a missing English member name', () => {
  const item = buildPatentInventorFields({ memberIds: ['park'] }, members);
  assert.equal(patentInventorDisplay(item, [{ ...park, nameEn: '' }], 'en'), '박종석');
  assert.equal(patentInventorDisplay({ inventorsKr: '김외부' }, [], 'en'), '김외부');
  assert.equal(patentInventorDisplay({}, members, 'en'), '');
});

check('localized comma-formatted member names and external repeated surnames remain intact', () => {
  const roster = [{ ...park, nameEn: 'Park, Jongseok' }];
  const item = { inventorsKr: '박종석', inventorsEn: 'Park, Jongseok, Doe, Jane, Doe, John' };
  assert.equal(patentInventorDisplay(item, roster, 'en'), item.inventorsEn);
});

check('a complete legacy English credit with unregistered initials is preserved without duplicating inventors', () => {
  const item = { inventorsKr: '박종석, 함승용', inventorsEn: 'J. Park, S. Ham' };
  assert.equal(patentInventorDisplay(item, members, 'en'), item.inventorsEn);
  assert.equal(patentInventorDisplay(item, members, 'kr'), item.inventorsKr);
  const withOutside = {
    ...item, inventorMemberIds: ['park', 'ham'],
    externalInventorsKr: '외부 발명자', externalInventorsEn: 'A. Outside'
  };
  assert.equal(patentInventorDisplay(withOutside, members, 'en'), 'Jongseok Park, Seungyong Ham, A. Outside');
  const incomplete = { inventorsKr: '박종석, 함승용, 외부 발명자', inventorsEn: 'J. Park, S. Ham, A. Outside' };
  const displayed = patentInventorDisplay(incomplete, members, 'en');
  assert.ok(displayed.includes('Jongseok Park'));
  assert.ok(displayed.includes('A. Outside'), 'An uncertain initials match must not erase an outside inventor');
});

check('mixed official order survives save, normalization, reopening, and both public languages', () => {
  const original = buildPatentInventorFields({ memberIds: ['park', 'ham'], externalInventorsKr: '김외부, 이외부', externalInventorsEn: 'Jane Doe; John Smith' }, members);
  const [parkEntry, hamEntry, jane, john] = original.inventorOrder;
  const saved = normalizePatent(buildPatentInventorFields({ inventorOrder: [john, hamEntry, jane, parkEntry] }, members, original));
  assert.equal(saved.inventorsKr, '이외부, 함승용, 김외부, 박종석');
  assert.equal(saved.inventorsEn, 'John Smith, Seungyong Ham, Jane Doe, Jongseok Park');
  assert.deepEqual(saved.inventorMemberIds, ['ham', 'park']);
  assert.deepEqual(resolvePatentInventors(saved, members).memberIds, ['ham', 'park']);
  assert.deepEqual(buildPatentInventorFields({}, members, saved), {
    inventorMemberIds: saved.inventorMemberIds, inventorMembers: saved.inventorMembers,
    externalInventorsKr: saved.externalInventorsKr, externalInventorsEn: saved.externalInventorsEn,
    inventorOrder: saved.inventorOrder, inventorsKr: saved.inventorsKr, inventorsEn: saved.inventorsEn
  });
  assert.equal(patentInventorDisplay(saved, members, 'kr'), saved.inventorsKr);
  assert.equal(patentInventorDisplay(saved, members, 'en'), saved.inventorsEn);
});

check('editing an older record preserves its interleaved member and outside order', () => {
  const legacy = { inventorsKr: '김외부, 박종석, 이외부, 함승용', inventorsEn: 'Jane Doe, Jongseok Park, John Smith, Seungyong Ham' };
  const saved = buildPatentInventorFields({}, members, legacy);
  assert.equal(saved.inventorsKr, legacy.inventorsKr);
  assert.equal(saved.inventorsEn, legacy.inventorsEn);
  const structured = { ...saved, inventorsKr: '김외부, 함승용, 이외부, 박종석', inventorsEn: '' };
  delete structured.inventorOrder;
  const opened = buildPatentInventorFields({}, members, structured);
  assert.equal(opened.inventorsKr, structured.inventorsKr);
  assert.equal(opened.inventorsEn, 'Jane Doe, Seungyong Ham, John Smith, Jongseok Park');
});

check('stored explicit order wins over stale concatenated display fields', () => {
  const saved = buildPatentInventorFields({ memberIds: ['park', 'ham'] }, members);
  saved.inventorOrder.reverse();
  assert.equal(patentInventorDisplay(saved, members, 'en'), 'Seungyong Ham, Jongseok Park');
  assert.deepEqual(resolvePatentInventors(saved, members).memberIds, ['ham', 'park']);
});

check('current names update in place after an ordered member is renamed', () => {
  const saved = buildPatentInventorFields({}, members, { inventorsKr: '김외부, 박종석, 함승용', inventorsEn: 'Jane Doe, Jongseok Park, Seungyong Ham' });
  const renamed = { ...park, nameKr: '박새이름', nameEn: 'New Name Park' };
  assert.equal(patentInventorDisplay(saved, [renamed, ham], 'en'), 'Jane Doe, New Name Park, Seungyong Ham');
  assert.equal(patentsForMember([{ id: 'p', ...saved }], renamed, [renamed, ham]).length, 1);
  assert.equal(patentInventorDisplay(saved, [], 'kr'), saved.inventorsKr);
});

check('a moved outside inventor keeps its slot while its Korean and English names are edited', () => {
  let saved = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '김외부, 이외부', externalInventorsEn: 'Jane Doe, John Smith' }, members);
  saved = buildPatentInventorFields({ inventorOrder: [saved.inventorOrder[2], saved.inventorOrder[0], saved.inventorOrder[1]] }, members, saved);
  saved = buildPatentInventorFields({ externalInventorsKr: '김수정, 이외부', inventorOrder: saved.inventorOrder }, members, saved);
  saved = buildPatentInventorFields({ externalInventorsEn: 'Jane Renamed, John Smith', inventorOrder: saved.inventorOrder }, members, saved);
  assert.equal(saved.inventorsKr, '이외부, 박종석, 김수정');
  assert.equal(saved.inventorsEn, 'John Smith, Jongseok Park, Jane Renamed');
});

check('a moved monolingual outside inventor keeps its slot during character-by-character editing', () => {
  let saved = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '김외부, 이외부' }, members);
  saved = buildPatentInventorFields({ inventorOrder: [saved.inventorOrder[2], saved.inventorOrder[0], saved.inventorOrder[1]] }, members, saved);
  for (const name of ['김', '김수', '김수정']) saved = buildPatentInventorFields({ externalInventorsKr: `${name}, 이외부`, inventorOrder: saved.inventorOrder }, members, saved);
  assert.equal(saved.inventorsKr, '이외부, 박종석, 김수정');
});

check('removed names vanish, remaining order stays intact, and new names append once', () => {
  let saved = buildPatentInventorFields({}, members, { inventorsKr: '김외부, 박종석, 이외부, 함승용', inventorsEn: 'Jane Doe, Jongseok Park, John Smith, Seungyong Ham' });
  saved = buildPatentInventorFields({ memberIds: ['ham'], externalInventorsKr: '이외부', externalInventorsEn: 'John Smith' }, members, saved);
  assert.equal(saved.inventorsKr, '이외부, 함승용');
  saved = buildPatentInventorFields({ memberIds: ['park', 'ham'], externalInventorsKr: '이외부, 새발명자', externalInventorsEn: 'John Smith, New Person' }, members, saved);
  assert.equal(saved.inventorsKr, '이외부, 함승용, 박종석, 새발명자');
  assert.deepEqual(saved.inventorMemberIds, ['ham', 'park']);
});

check('explicit separators preserve paired comma surnames as individually movable outside inventors', () => {
  const saved = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '김외부; 이외부', externalInventorsEn: 'Doe, Jane; Doe, John' }, members);
  assert.equal(saved.inventorOrder.length, 3);
  assert.equal(saved.inventorOrder[1].nameEn, 'Doe, Jane');
  const reordered = buildPatentInventorFields({ inventorOrder: [saved.inventorOrder[2], saved.inventorOrder[0], saved.inventorOrder[1]] }, members, saved);
  assert.equal(reordered.inventorsEn, 'Doe, John, Jongseok Park, Doe, Jane');
  assert.equal(reordered.externalInventorsEn, 'Doe, Jane; Doe, John');
});

check('ambiguous bilingual outside names remain an intact movable group without guessing pairs', () => {
  const saved = buildPatentInventorFields({ memberIds: ['park'], externalInventorsKr: '김외부, 이외부', externalInventorsEn: 'Doe, Jane, Doe, John' }, members);
  assert.equal(saved.inventorOrder.length, 2);
  const moved = buildPatentInventorFields({ inventorOrder: [saved.inventorOrder[1], saved.inventorOrder[0]] }, members, saved);
  assert.equal(moved.inventorsKr, '김외부, 이외부, 박종석');
  assert.equal(moved.inventorsEn, 'Doe, Jane, Doe, John, Jongseok Park');
  assert.equal(moved.externalInventorsEn, saved.externalInventorsEn);
});

check('invalid or duplicated order entries cannot omit valid names or relink deselected members', () => {
  const saved = buildPatentInventorFields({ memberIds: ['park', 'ham'], externalInventorsKr: '김외부' }, members);
  const result = buildPatentInventorFields({ memberIds: ['ham'], inventorOrder: [null, saved.inventorOrder[2], saved.inventorOrder[2], { memberId: 'unknown' }, saved.inventorOrder[0]] }, members, saved);
  assert.equal(result.inventorsKr, '김외부, 함승용');
  assert.deepEqual(result.inventorMemberIds, ['ham']);
  const unlinked = { ...saved, inventorMemberIds: [] };
  assert.deepEqual(resolvePatentInventors(unlinked, members).memberIds, []);
  assert.deepEqual(patentsForMember([unlinked], park, members), []);
});

check('order snapshots retain missing members even if the older snapshot field is absent', () => {
  const saved = buildPatentInventorFields({ memberIds: ['park'] }, members);
  delete saved.inventorMembers;
  assert.equal(patentInventorDisplay(saved, [], 'en'), 'Jongseok Park');
});

check('editing complete legacy initials credits does not create duplicate outside inventors', () => {
  const saved = buildPatentInventorFields({}, members, { inventorsKr: '박종석, 함승용', inventorsEn: 'J. Park, S. Ham' });
  assert.equal(saved.inventorOrder.length, 2);
  assert.equal(saved.inventorsEn, 'Jongseok Park, Seungyong Ham');
});

check('known member anchors preserve interleaved legacy comma surnames through repeated editing', () => {
  const legacy = { inventorsKr: '외부1, 박종석, 외부2, 함승용', inventorsEn: 'Doe, Jane, Jongseok Park, Doe, John, Seungyong Ham' };
  let saved = buildPatentInventorFields({}, members, legacy);
  assert.equal(saved.inventorsKr, legacy.inventorsKr);
  assert.equal(saved.inventorsEn, legacy.inventorsEn);
  assert.equal(saved.inventorOrder.length, 4);
  saved = buildPatentInventorFields({ inventorOrder: saved.inventorOrder }, members, saved);
  assert.equal(saved.inventorsKr, legacy.inventorsKr);
  assert.equal(saved.inventorsEn, legacy.inventorsEn);
  const moved = buildPatentInventorFields({ inventorOrder: [saved.inventorOrder[2], saved.inventorOrder[1], saved.inventorOrder[0], saved.inventorOrder[3]] }, members, saved);
  assert.equal(moved.inventorsEn, 'Doe, John, Jongseok Park, Doe, Jane, Seungyong Ham');
});

console.log(`Patent inventor verification passed (${checks} checks).`);
