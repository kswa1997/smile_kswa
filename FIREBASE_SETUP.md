# Firebase 보안 및 서버 배포

대상: smile-of-kswa / kswa1997/smile_kswa / https://smile-kswa.vercel.app

## 운영 보안 규칙

2026-10-17 Firebase 콘솔에 읽기·쓰기 false 규칙을 게시했습니다. 비로그인 REST 요청의 Permission denied 응답을 확인했습니다.

```json
{ "rules": { ".read": false, ".write": false } }
```

브라우저는 Firebase에 직접 접근하지 않습니다. /api/app 서버만 서비스 계정으로 접속합니다. 공개 규칙으로 되돌리지 마세요.

## 배포 설정

Vercel 프로젝트 Production 환경에 다음 값을 Secret/Sensitive로 저장한 뒤 재배포합니다.

- FIREBASE_SERVICE_ACCOUNT_JSON: smile-of-kswa 프로젝트 서비스 계정 JSON 키 전체.
- SESSION_SECRET: 암호학적 난수 32바이트 이상의 문자열. 서버 쿠키 서명용.
- APP_ORIGIN: 선택 사항. 기본 https://smile-kswa.vercel.app.
- ADMIN_PASSWORD_HASH: 선택 사항. 초기 설정 링크 대신 관리자 해시를 사전 등록할 때 사용.

VITE_ 접두사를 붙이지 마세요. 키를 GitHub, public, dist 또는 채팅에 넣지 마세요.
현재 서버 키 다운로드·환경변수 설정·수정 코드 배포 완료 여부는 운영 화면에서 별도로 확인해야 합니다.

## 관리자 초기 설정

공개 코드에 들어 있던 기본 관리자 비밀번호는 사용할 수 없습니다. 관리자 ID는 kswa1997입니다.
새 비밀번호는 사용자가 직접 입력·확인·제출해야 합니다.
서버 SESSION_SECRET으로 생성한 시간 제한 토큰을 URL의 #setup=에 넣으면 초기 설정 화면이 열립니다.
토큰은 최초 한 번만 사용할 수 있고 시간 제한이 있습니다. 토큰을 다른 사람과 공유하지 마세요.
URL 조각은 화면을 열 때 지우므로 요청 URL과 referrer에 포함되지 않습니다.

해시를 사전 등록하려면 프로젝트 폴더에서 다음 명령을 직접 실행하고 출력 해시를 ADMIN_PASSWORD_HASH로 저장합니다.

```powershell
powershell -ExecutionPolicy Bypass -File tools/set-admin-password.ps1
```

## 구현

- 기존 이름/비밀번호로 서버에서 로그인합니다. 성공한 기존 비밀번호는 scrypt 해시로 전환합니다.
- 브라우저 응답과 Excel에 비밀번호·해시·서버 키를 포함하지 않습니다.
- HttpOnly / Secure / SameSite=Strict 쿠키로 세션을 보관합니다. localStorage의 기존 인증 정보는 제거합니다.
- 요청마다 서버가 DB의 회원 존재, 현재 권한, 비밀번호 버전을 재검증합니다.
- 일반 회원은 자기 정보와 자기 기록만 조회합니다.
- 부관리자는 마일리지 관리가 가능합니다. 가입 승인·권한 지정은 관리자만 가능합니다.
- 가입·비밀번호 요청은 공개 데이터 조회 없이 접수하고 계정 존재 여부를 노출하지 않습니다.
- 비밀번호 변경과 기록 삭제 확인도 서버에서 검증합니다.
- 마일리지 승인·기록·삭제 로그는 Firebase ETag 조건부 저장으로 원자적으로 반영합니다.
- 알 수 없는 기존 루트 데이터(messages, messageReads 등)는 보존합니다. 최신 앱에 없는 구형 쪽지 화면을 추가하지 않습니다.
- 예전 비밀번호 조회/전달 기능은 제거했습니다. 비번 요청은 학회가 본인 확인 후 재설정을 안내하는 용도이며 자동 복구 기능은 없습니다.

기존 비밀번호와 관리자 권한 데이터는 이미 공개되었을 가능성이 있습니다. 해시 전환이 과거 노출을 취소하지는 않습니다. 회원에게 비밀번호 변경을 안내하고 관리자 권한 목록을 확인해야 합니다.

## 검증

npm test / npm run build

test/ui-server.mjs는 운영 DB에 연결하지 않는 로컬 가상 회원 검증 서버입니다.
실제 배포 후 회원 로그인과 관리자 초기 설정은 별도로 확인해야 합니다.

공식 문서:
- https://firebase.google.com/docs/database/security
- https://firebase.google.com/docs/database/rest/auth
- https://firebase.google.com/docs/database/rest/save-data
- https://vercel.com/docs/functions/runtimes/node-js
