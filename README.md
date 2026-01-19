# 시네마틱 스토리보드 아티스트

한 장의 인물 사진으로 9단계의 시네마틱 스토리보드를 자동 생성하고, 나노바나나 프로 모델(또는 Flash 모델)로 이미지를 렌더링하는 웹앱입니다.

## 주요 기능

- 레퍼런스 이미지 분석으로 9개 장면 프롬프트 자동 생성
- Cinematic Shots / What's Next / Cinematic Zooms 3가지 모드 지원
- API Key 검증 후 Pro 모델 사용 가능, 미지원 시 자동으로 Flash 모델로 전환
- 생성된 이미지 개별 다운로드 및 전체 다운로드 지원

## 사용 방법 (웹앱)

1. 우측 상단의 **Set API Key** 버튼을 눌러 개인 Gemini API Key를 입력합니다.
2. 키를 저장하면 검증 결과가 표시됩니다.
   - 검증 완료 + Pro 지원: Pro 모델 사용 가능
   - 검증 완료 + Pro 미지원: Flash 모델로 자동 사용
3. 홈에서 원하는 모드를 선택하고, 레퍼런스 이미지를 업로드합니다.
4. **Generate Blueprint**를 눌러 9개 장면의 기획서를 생성합니다.
5. **Production** 버튼을 눌러 이미지를 생성합니다.
6. 생성된 이미지는 카드 우측 상단의 **Download** 버튼으로 개별 저장하거나, 상단의 **Download All**로 전체 저장할 수 있습니다.

## 로컬 실행

**필수:** Node.js 18 이상 권장

1. 의존성 설치
   `npm install`
2. 개발 서버 실행
   `npm run dev`

## GitHub Pages 배포

이 저장소는 GitHub Actions로 자동 배포됩니다.

1. `main` 브랜치에 푸시하면 Actions가 `dist`를 빌드해 Pages로 배포합니다.
2. 배포 URL 형식:
   `https://<GitHubID>.github.io/Cinematic-Storyboard/`

## API Key 안내

- 키는 브라우저 로컬 스토리지에 저장됩니다.
- 입력한 키는 앱에서만 사용되며 서버로 전송되지 않습니다.
- 키를 재설정하거나 연결 해제할 수 있습니다.
