# Firebase Realtime Database 연결 방법

가입신청 저장 오류가 뜨면 Realtime Database가 아직 만들어지지 않았거나, Vercel 환경변수에 실제 DB URL이 들어가지 않은 상태입니다.

## 1. Realtime Database 만들기

1. Firebase 콘솔에서 `smile-of-kswa` 프로젝트로 이동합니다.
2. 왼쪽 메뉴에서 `Build` > `Realtime Database`를 선택합니다.
3. `데이터베이스 만들기`를 누릅니다.
4. 위치는 가까운 리전이 있으면 그 리전을 선택합니다. 보통 아시아권은 `asia-southeast1`을 사용할 수 있습니다.
5. 생성 후 상단에 나오는 URL을 복사합니다.

URL 예시는 다음과 비슷합니다.

```txt
https://smile-of-kswa-default-rtdb.asia-southeast1.firebasedatabase.app
```

## 2. Vercel 환경변수 추가

Vercel 프로젝트 설정에서 다음 환경변수를 추가합니다.

```txt
VITE_FIREBASE_DB_URL=Firebase에서 복사한 Realtime Database URL
```

환경변수를 추가한 뒤에는 반드시 Vercel에서 다시 배포해야 합니다.

## 3. 권한 오류가 나올 때

Realtime Database가 만들어졌는데도 저장이 안 되면 규칙 문제일 가능성이 큽니다. 개발/테스트 중에는 아래처럼 임시로 열 수 있습니다.

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

이 규칙은 테스트용입니다. 실제 운영에서는 Firebase Authentication 기반 규칙으로 바꾸는 것이 안전합니다.
