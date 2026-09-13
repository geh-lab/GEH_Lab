# GEH Lab 업로드본

2026-09-13 최신 수정본입니다. 홈 사진 9장, 리퀴드 글래스, 검색 가독성, 모바일·글자 확대, 연구 관심 분야 수정이 포함되어 있습니다.

## 업로드할 내용

이 `GEH_Lab-main` 폴더 안의 **모든 파일과 하위 폴더**를 기존 GEH Lab 저장소의 최상위에 덮어써 주세요. `package.json`, `index.html`, `assets`, `en`이 기존 저장소의 같은 위치에 들어가면 됩니다.

- 페이지와 공통 파일: 현재 폴더의 HTML·JS·CSS·JSON 파일, `robots.txt`, `sitemap.xml`, `.gitignore`
- 하위 폴더: `assets`, `en`, `scripts`, `firebase`
- Vercel 설정: `vercel.json`, `vite.config.js`, `package.json`, `package-lock.json`

업로드 후 저장소에 변경을 저장하고, 연결된 Vercel 프로젝트에서 배포하면 됩니다.

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
