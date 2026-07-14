## 버전
배포용(실제 Firebase Auth/Firestore 사용)

# GEH Lab bilingual site

구성
- 국문 공개 페이지: `index.html`, `members.html`, `projects.html`, `publications.html`
- 영문 공개 페이지: `en/index.html`, `en/members.html`, `en/projects.html`, `en/publications.html`
- 관리자 페이지: `admin.html`

실제 실행 파일
- 공통 스타일: `assets/css/styles.css`
- 공개 페이지: `assets/js/public.js`
- 관리자 페이지: `assets/js/admin.js`
- Firebase / 데이터 정규화: `assets/js/firebase.js`, `assets/js/data.js`, `assets/js/utils.js`
- 루트 `styles.css`, `public.js`, `admin.js`는 예전 URL 호환용 진입점이며 실제 구현을 중복하지 않습니다.

보관 중인 구버전
- `member_final.html`, `papers_final.html`, `reserch_final.html`은 현재 내비게이션·Vercel 리다이렉트·실행 HTML에서 참조되지 않고 필요한 `assets/css/main.css`, jQuery 스크립트도 포함되어 있지 않습니다.
- `assets/js/app.js`, `assets/js/fallback-data.js` 역시 현재 페이지에서 import되지 않습니다.
- `assets/images/background/research-map.png`, `assets/images/mainpic.png`, `assets/images/mainpic.webp`는 현재 실행 코드에서 참조되지 않아 소스에는 보관하되 Vite 배포 산출물에서는 제외합니다.
- 운영 데이터 유실 위험을 피하기 위해 삭제하지 않고 deprecated 상태로 보관합니다. 신규 변경은 위의 실제 실행 파일에만 반영합니다.

반영 사항
- 국문 / 영문 분리
- 공개 페이지 공통 헤더에 태극기·성조기와 KO·EN 코드를 결합한 접근 가능한 언어 선택기
- 아코디언은 원형 버튼 정중앙의 `+ / −` 상태 표시를 사용
- 공개 페이지는 인증·스토리지를 제외한 Firestore 전용 지연 로더를 사용하고 페이지별 필수 컬렉션만 요청
- 첫 페인트 전에 최종 헤더·reveal 상태를 고정해 이전 마크업이 잠깐 보이는 현상 방지
- 화면용 로고·교수 사진은 경량 WebP를 사용하고 원본 이미지는 소스 보관
- 관리자 Google 로그인 유지
- 멤버 / 과제 / 논문 Firebase CRUD
- 멤버, 종료 과제, 논문 연도별 아코디언
- 모바일 대응 레이아웃
- 로그인 후 기본 데이터 자동 동기화(컬렉션이 비어 있을 때만)

배포
1. 저장소 루트 파일을 이 폴더 내용으로 교체
2. `firebase-config.js` 값 확인
3. Firebase Console에 `firebase/firestore.rules`, `firebase/storage.rules` 반영
4. Firebase Authentication → Settings → Authorized domains에 `geh-lab.vercel.app`과 실제 사용하는 커스텀/Preview 도메인 등록
5. Vercel 재배포


## 로컬 개발 모드

- 공개 페이지는 `firebase-config.js`가 설정되어 있으면 localhost에서도 실제 Firestore의 공개 데이터를 읽어 배포 화면과 목록을 동기화합니다.
- Firebase 설정이 있으면 관리자 페이지도 localhost에서 운영과 동일하게 **Google 로그인 + 실제 Firestore/Storage**를 사용합니다. Firebase Authentication의 Authorized domains에 `localhost`와 `127.0.0.1`을 등록해야 합니다.
- 공개·관리자 페이지를 완전한 로컬 데이터로 확인하려면 `window.GEH_LOCAL_DEV_MODE = true`를 명시하면 됩니다.
- 배포 도메인(`geh-lab.vercel.app`)에서는 기존 Firebase 인증/Firestore를 그대로 사용합니다.
- 로컬 데이터 초기화가 필요하면 브라우저 개발자도구에서 `localStorage.clear()` 또는 `geh-local-collection:*`, `geh-local-admin-auth` 키만 지우면 됩니다.
