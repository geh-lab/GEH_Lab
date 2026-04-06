# CNU GEH Lab 리디자인 사이트

업로드하신 기존 사이트를 바탕으로 **공개용 연구실 웹사이트 + Firebase 관리자 CMS** 구조로 다시 만든 버전입니다.

이 버전은 **빌드 없이 바로 배포되는 정적 HTML/CSS/JS 구조**라서, React/TS 파일만 올렸을 때 생길 수 있는 빈 화면 문제를 피하기 쉽습니다.

## 포함된 기능

### 공개 사이트
- 애플 웹사이트 느낌의 대형 타이포 + 글래스 UI + 모션 효과
- Home / Members / Projects / Publications를 각각 별도 페이지로 구성
- 멤버/논문/과제 데이터를 한 구조로 렌더링
- 논문 검색 기능
- 졸업자(Alumni) 영역 분리
- Vercel 정적 배포 친화적 구조

### 관리자 페이지
`/admin` 또는 `/admin.html`
- Firebase Authentication 로그인
- 멤버 추가 / 수정 / 삭제
- 멤버 사진 업로드 (클릭 또는 드래그 앤 드롭)
- 멤버 “졸업 처리” → Alumni 영역으로 이동
- 졸업 후 현재 진로/취업처 입력 가능
- 논문 추가 / 수정 / 삭제
- 과제 추가 / 수정 / 삭제
- 진행중 과제 ↔ 종료 과제 전환
- 기존 사이트 데이터를 Firebase에 한 번에 넣는 **초기 데이터 업로드 버튼** 포함

---

## 폴더 구조

```text
.
├── index.html
├── members.html
├── projects.html
├── publications.html
├── admin.html
├── firebase-config.js
├── vercel.json
├── assets
│   ├── css/styles.css
│   ├── js/
│   │   ├── app.js
│   │   ├── admin.js
│   │   ├── firebase.js
│   │   ├── fallback-data.js
│   │   └── utils.js
│   └── images/
├── firebase
│   ├── firestore.rules
│   └── storage.rules
└── README.md
```

---

## 바로 적용하는 방법

### 1. GitHub 저장소에 파일 교체
기존 정적 사이트 파일 대신 이 폴더 내용을 그대로 업로드합니다.

### 2. Vercel 자동 배포
이미 GitHub 저장소와 Vercel이 연결되어 있다면:
- GitHub에 push
- Vercel이 자동으로 새 배포 생성

`vercel.json`이 들어 있어서 `.html` 확장자 없이도 접근하기 쉽습니다.

---

## Firebase 설정 방법

### 1. Firebase 프로젝트 준비
Firebase Console에서 아래를 활성화하세요.
- Authentication → **Email/Password**
- Firestore Database
- Storage

### 2. `firebase-config.js` 수정
루트의 `firebase-config.js` 파일을 열어서:

```js
window.GEH_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

window.GEH_ADMIN_EMAILS = ["실제관리자이메일@example.com"];
```

### 3. Firestore / Storage 규칙 적용
아래 파일 내용을 Firebase Console에 복사해 넣으세요.
- `firebase/firestore.rules`
- `firebase/storage.rules`

**중요:**  
현재 규칙 파일에는 예시 이메일 `admin@example.com` 이 들어 있으니 반드시 **실제 관리자 이메일로 바꾼 뒤** 적용해야 합니다.

### 4. 관리자 계정 생성
Firebase Authentication에서 관리자용 이메일/비밀번호 계정을 하나 만듭니다.

### 5. 관리자 페이지 접속
배포 후:
- 공개 사이트 홈: `/`
- 멤버 페이지: `/members`
- 과제 페이지: `/projects`
- 논문 페이지: `/publications`
- 관리자 페이지: `/admin`

---

## 초기 데이터 넣는 방법

처음에는 공개 사이트가 **내장된 fallback 데이터**로 보입니다.
Firebase가 잠시 연결되지 않아도 공개 페이지는 fallback 데이터로 먼저 렌더링되도록 구성했습니다.  
Firebase 연결 후 관리자 페이지에 로그인하면 사이드바에 있는:

**현재 사이트 데이터로 시작하기**

버튼을 눌러서,
- 멤버
- 과제
- 논문

데이터를 Firebase 컬렉션으로 한 번에 업로드할 수 있습니다.

그 후부터는 Firebase 데이터를 우선 사용합니다.

---

## 데이터 구조

### members
예시 필드
- `name`
- `group`
- `track`
- `course`
- `email`
- `bio`
- `education`
- `experience`
- `researchInterest`
- `currentPosition`
- `status` (`active` / `alumni`)
- `graduationYear`
- `sortOrder`
- `photoUrl`
- `photoPath`

### publications
- `title`
- `authors`
- `journal`
- `year`
- `doi`
- `url`
- `abstract`
- `sortOrder`

### projects
- `title`
- `description`
- `status` (`ongoing` / `completed`)
- `period`
- `year`
- `tags`
- `sortOrder`

---

## 운영 팁

- 멤버를 졸업 처리하면 공개 사이트의 Alumni 영역으로 내려갑니다.
- 논문은 DOI만 넣어도 되고, DOI가 없으면 URL을 넣어도 됩니다.
- 과제는 진행중 / 종료 상태를 버튼으로 바로 바꿀 수 있습니다.
- 멤버 사진은 Firebase Storage의 `member-photos/` 아래에 저장됩니다.

---

## 추천 후속 작업

이 상태로도 바로 운영 가능하지만, 다음 확장도 쉽게 붙일 수 있습니다.
- 홈 상단 텍스트까지 관리자에서 수정
- 연구실 사진 갤러리
- 뉴스 / 공지사항 섹션
- 다국어(한/영) 토글
- 교수님 대표 논문 featured 영역

