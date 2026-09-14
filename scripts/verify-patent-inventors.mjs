import assert from 'node:assert/strict';
import { buildPatentInventorFields, patentsForMember, resolvePatentInventors } from '../assets/js/patent-inventors.js';
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

console.log(`Patent inventor verification passed (${checks} checks).`);
