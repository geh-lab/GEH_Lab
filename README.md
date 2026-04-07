# GEH Lab bilingual site

구성
- 국문 공개 페이지: `index.html`, `members.html`, `projects.html`, `publications.html`
- 영문 공개 페이지: `en/index.html`, `en/members.html`, `en/projects.html`, `en/publications.html`
- 관리자 페이지: `admin.html`

반영 사항
- 국문 / 영문 분리
- 관리자 Google 로그인 유지
- 멤버 / 과제 / 논문 Firebase CRUD
- 멤버, 종료 과제, 논문 연도별 아코디언
- 모바일 대응 레이아웃
- 로그인 후 기본 데이터 자동 동기화(컬렉션이 비어 있을 때만)

배포
1. 저장소 루트 파일을 이 폴더 내용으로 교체
2. `firebase-config.js` 값 확인
3. Firebase Console에 `firebase/firestore.rules`, `firebase/storage.rules` 반영
4. Vercel 재배포
