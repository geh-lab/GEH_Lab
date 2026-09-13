import { escapeHTML } from './utils.js';

// Shared by the initial HTML and live rendering so totals and labels stay aligned.
export function memberSummary(members = [], lang = 'kr') {
  const en = lang === 'en';
  const current = members.filter(item => item.status !== 'alumni' && ['pi', 'researchProfessor', 'graduateStudent', 'studentResearcher'].includes(item.group));
  const group = key => current.filter(item => item.group === key);
  const faculty = group('pi');
  const researchers = group('researchProfessor');
  const students = group('graduateStudent');
  const degrees = (items, showEmpty = false) => {
    const counts = [
      [en ? 'Ph.D.' : '박사', items.filter(item => ['phd', 'doctoral', 'phdCompleted'].includes(item.course)).length],
      [en ? 'M.S.' : '석사', items.filter(item => ['ms', 'masters'].includes(item.course)).length]
    ];
    const unspecified = items.length - counts.reduce((sum, [, count]) => sum + count, 0);
    if (showEmpty && unspecified) counts.push([en ? 'Degree unspecified' : '학위 미지정', unspecified]);
    return counts.filter(([, count]) => showEmpty || count).map(([label, count]) => `${label} ${count}`).join(' · ');
  };
  const trackDetail = (label, items) => `${label} ${items.length} (${degrees(items, true)})`;
  const studyTracks = [
    trackDetail(en ? 'Full-time' : '풀타임', students.filter(item => item.track === 'fullTime')),
    trackDetail(en ? 'Part-time' : '파트타임', students.filter(item => item.track === 'partTime'))
  ];
  const unspecified = students.filter(item => !['fullTime', 'partTime'].includes(item.track));
  if (unspecified.length) studyTracks.push(trackDetail(en ? 'Unspecified' : '미지정', unspecified));
  const alumni = members.filter(item => item.status === 'alumni');
  return {
    stats: [
      { label: en ? 'Faculty & postdocs' : '교수 · 박사후연구원', value: faculty.length + researchers.length, detail: en ? `PI ${faculty.length} · Research faculty / postdocs ${researchers.length}` : `지도교수 ${faculty.length} · 연구교수 / 박사후 ${researchers.length}` },
      { label: en ? 'Graduate students' : '대학원생', value: students.length, detail: studyTracks.join('\n') },
      { label: en ? 'Undergraduate researchers' : '학부연구생', value: group('studentResearcher').length, detail: '' },
      { label: en ? 'Alumni' : '졸업생', value: alumni.length, detail: degrees(alumni) }
    ]
  };
}

export function memberSummaryMarkup(members, lang) {
  return memberSummary(members, lang).stats.map(item => `<article class="stat-card stat-card--summary reveal"><span>${escapeHTML(item.label)}</span><strong>${item.value}</strong>${item.detail ? `<div class="stat-card__meta"><small>${escapeHTML(item.detail)}</small></div>` : ''}</article>`).join('');
}
