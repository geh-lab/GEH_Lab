# GitHub 업로드 · r6

기존 GitHub → Vercel 자동 배포 방식을 그대로 사용합니다.

1. ZIP을 풀고 `GEH_Lab-main` **안의 내용 전체**를 기존 `geh-lab/GEH_Lab` 저장소 루트에 덮어씁니다. 저장소 안에 `GEH_Lab-main` 폴더를 한 겹 더 넣지 마세요.
2. `assets`, `en`, `scripts`, `firebase`, `api`, `server` 폴더와 함께, 루트의 `package.json`, `package-lock.json`, `vercel.json`, `vite.config.js`, HTML·공통 파일을 교체합니다. 폴더만 올리면 루트 설정은 바뀌지 않습니다.
3. GitHub에서 업로드 내용을 커밋합니다. 여러 번에 나누어 올렸다면 **마지막 커밋의 Vercel 배포**가 성공했는지 확인합니다.

업로드 후 GitHub에서 다음 두 파일을 열어 확인하면 됩니다.

- `package.json`: `build`에 `verify-deployment-source.mjs`와 `prepare-public-pages.mjs`가 모두 있어야 하고, `dependencies`에 `linkedom`이 있어야 합니다.
- `vercel.json`: `functions`와 `rewrites`가 있어야 합니다.

배포 로그에는 아래 두 줄이 나옵니다.

```text
Deployment source verified (server function, renderer, browser entry, 14 routes; 0 legacy HTML entries repaired).
Public server pages prepared (12 templates, 14 routes; no static route collisions).
```

그 뒤 사이트의 홈과 멤버 페이지를 새로 열어 확인합니다. `/api/public-page?page=members&lang=kr`가 404라면 새 서버 함수가 아직 제공되지 않는 배포입니다.

Firebase 추가 설정은 이번 실행 복구에 필요하지 않습니다. 이 ZIP에는 `node_modules`, `dist`, `.server`를 넣지 않았습니다. 이미 저장소에서 추적 중인 생성 폴더는 제외하고 소스만 관리하세요. `.server`는 배포 빌드에서 자동 생성됩니다.

r6는 멤버·특허의 국문·영문 현황 숫자에 증가 모션을 추가한 업로드본이며 운영 배포를 대신 수행한 것은 아닙니다.
