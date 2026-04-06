# CNU GEH Lab 사이트 · Google 로그인 관리자 버전

이 버전은 **관리자 페이지를 이메일/비밀번호 입력 폼이 아닌 Google 로그인 버튼 방식**으로 고친 최종본입니다.

## 이번 수정 핵심

- 관리자 페이지 로그인 카드를 **Google 로그인 전용 UI**로 변경
- `firebase-config.js`에 **사용 중인 Firebase 프로젝트 값** 반영
- `GEH_ADMIN_EMAILS`를 `envlab1315@gmail.com`으로 설정
- `firebase/firestore.rules`, `firebase/storage.rules`도 같은 관리자 이메일 기준으로 수정
- 관리자 첫 화면에 **Google sign-in edition · v2** 표시를 추가해서, 새 배포가 적용되었는지 바로 확인 가능

## 배포 전에 꼭 할 일

기존 저장소에 아래처럼 예전 파일이 남아 있으면 Vercel이 다른 결과물을 계속 보여줄 수 있습니다.

- `vite.config.js`
- 예전 React / Vite 소스
- `member_final.html`, `papers_final.html`, `reserch_final.html` 같은 이전 테스트 파일
- 예전 `admin.html`, `assets/js/admin.js`, `assets/js/firebase.js`

이 폴더 내용으로 **저장소 루트를 통째로 교체**하는 쪽이 가장 안전합니다.

## Firebase Console 체크리스트

### Authentication
- Google provider 활성화
- Authorized domains에 `geh-lab.vercel.app` 추가

### Firestore
- Database 생성
- `firebase/firestore.rules` 내용 반영

### Storage
- Bucket 생성
- `firebase/storage.rules` 내용 반영

## 현재 들어 있는 관리자 이메일

```js
window.GEH_ADMIN_EMAILS = ["envlab1315@gmail.com"];
```

Google 로그인 후 이 이메일이 아니면 자동 로그아웃됩니다.

## 배포 후 정상 여부 확인

정상 배포라면 `/admin.html`에서:

- 이메일/비밀번호 입력칸이 없어야 함
- 큰 버튼으로 **Google 계정 선택 창 열기**가 보여야 함
- 상단에 **Google sign-in edition · v2** 배지가 보여야 함

이 3개 중 하나라도 안 보이면, 새 버전이 아니라 예전 파일이 배포된 것입니다.
