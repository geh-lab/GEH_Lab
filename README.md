# GEH Lab 업로드본

2026-09-14 최신 수정본입니다. 홈 사진 위 글래스 패널 안에 구성원·과제·논문·특허·게시판 숫자를 표시하며, 관리자 편집창의 박스와 저자 선택 배치를 정리했습니다.

## 업로드할 내용

이 `GEH_Lab-main` 폴더 안의 **모든 파일과 하위 폴더**를 기존 GEH Lab 저장소의 최상위에 덮어써 주세요. `package.json`, `index.html`, `assets`, `en`이 기존 저장소의 같은 위치에 들어가면 됩니다.

- 페이지와 공통 파일: 현재 폴더의 HTML·JS·CSS·JSON 파일, `robots.txt`, `sitemap.xml`, `.gitignore`
- 하위 폴더: `assets`, `en`, `scripts`, `firebase`
- Vercel 설정: `vercel.json`, `vite.config.js`, `package.json`, `package-lock.json`

업로드 후 저장소에 변경을 저장하고, 연결된 Vercel 프로젝트에서 배포하면 됩니다.

특히 `index.html`과 `en/index.html`도 함께 덮어써야 합니다. `assets`만 업데이트하면 새 CSS와 예전 홈 HTML이 섞여 숫자 정보가 사진 아래에 남습니다. 저장소의 두 홈 HTML에서 `home-overview`를 검색하면 업로드가 반영됐는지 확인할 수 있습니다. 두 파일 모두 이 영역 안에 `id="hero-stat-grid"`가 있어야 합니다.

빌드가 끝나면 두 언어의 홈 배치와 CSS를 자동 검사합니다. 이전 홈 파일이 남아 있으면 오류로 빌드를 중단하므로, 파일을 맞춘 뒤 새 커밋으로 다시 배포하세요.

기존 GitHub 저장소에 `node_modules`와 `dist`가 올라가 있다면 저장소에서도 삭제해 주세요. `.gitignore`를 덮어쓰는 것만으로 이미 등록된 파일이 삭제되지는 않습니다.

## Vercel 빌드 설정

- 프로젝트 루트: `package.json`이 있는 위치
- 설치 명령: `npm ci --include=dev`
- 빌드 명령: `npm run build`
- 결과 폴더: `dist`

이 값은 `vercel.json`에 설정되어 있습니다. `node_modules`와 `dist`는 설치·빌드 과정에서 생성되므로 업로드본에서 제외했습니다.

의존성은 빌드할 때 기존 설치본을 제거하고 다시 설치합니다. Vite는 `node ./node_modules/vite/bin/vite.js`로 실행하므로 ZIP 업로드 과정에서 실행 권한이 빠져도 빌드 명령이 실행됩니다.

## Vite 실행 권한 오류 수정 시

`node_modules/.bin/vite: Permission denied`로 배포가 실패했다면 이 폴더의 `package.json`과 `vercel.json`을 기존 저장소의 같은 파일에 덮어쓰고 새 커밋으로 배포하세요. 위의 설치 명령은 이전 의존성 폴더를 새로 설치하므로 캐시된 실행 파일도 재사용하지 않습니다.

로컬에서 확인하려면 `npm ci` 후 `npm run verify`를 실행하세요.

## 홈 특허 집계와 Firebase 규칙

홈 요약에 구성원·과제·논문·특허·게시판을 표시합니다. 특허 총계와 등록·출원 건수는 특허 페이지와 같은 데이터에서 자동 집계합니다.

특허 카드에 `—`와 조회 실패 안내가 나오고 `patents` 조회가 `Missing or insufficient permissions`로 거부된다면 Firebase의 특허 읽기 권한을 확인하세요. `firebase/firestore.rules`에는 특허 공개 조회 및 관리자 쓰기 규칙이 포함되어 있지만, GitHub 업로드나 Vercel 재배포가 Firestore 규칙을 적용하지는 않습니다.

Firebase 프로젝트의 Firestore 규칙에서 기존 관리자 권한과 다른 컬렉션 규칙을 유지하며, `match /databases/{database}/documents` 안에 아래 블록을 반영해야 합니다. `isAdmin()`은 해당 규칙 파일에 정의된 기존 관리자 확인 함수입니다.

```text
match /patents/{docId} {
  allow read: if true;
  allow write: if isAdmin();
}
```
