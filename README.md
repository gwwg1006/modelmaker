# Modelmaker

문구를 입력하고 색을 고르면 **Bambu Lab P2S / H2S용 멀티컬러 이름표·명패 3MF**를 만들어 주는 웹앱입니다. 이름이 바뀔 때마다 반복하던 글자 모델링, 받침판 제작, 정렬, 부품 분리, 색상 배정을 자동화합니다.

## 기능

- 여러 줄 문구 입력, 정렬(좌/중/우), 폰트(Noto Sans KR Bold/Black) 선택
- 받침판 크기·두께·모서리 반경, 글자 돌출 높이, 여백 조절
- 글자 단위 색상 배정 (팔레트 슬롯)
- 3D 미리보기 (원근 / 위 / 옆)
- Bambu Studio에서 열 수 있는 프로젝트 `.3mf` 내보내기 (P2S, H2S 프로파일 포함)

## 실행

Node.js(LTS)와 npm이 필요합니다.

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 타입 검사 + 프로덕션 빌드
```

## 구조

```text
src/
├── App.tsx            앱 상태와 화면 조립
├── domain.ts          이름표 설계 타입
├── components/        Topbar, Preview, Palette, StatusBar
└── core/
    ├── text.ts        폰트 해석, 글자 배치, 입력 검증
    ├── mesh.ts        받침판·글자 메시 생성 (압출)
    ├── export3mf.ts   Bambu 프로젝트 3MF 패키징
    └── profiles/      p2s.json, h2s.json
기획안.md              제품 기획안
```

## 현재 상태와 한계

- `npm run build`는 통과합니다. 자동 테스트는 아직 없습니다.
- 내보낸 3MF를 Bambu Studio와 실제 프린터로 출력해 본 검증은 이 저장소에 기록되어 있지 않습니다. 출력 전에 Bambu Studio에서 필라멘트 배정과 슬라이싱 결과를 확인하세요.
- 자세한 설계 배경과 범위는 [기획안.md](기획안.md)를 참고하세요.
