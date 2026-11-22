# 화면용 Pretendard GOV

외부 접속이 막힌 PC에서도 화면 글꼴을 읽을 때 쓰는 공식 dynamic-subset 배포본이다. 화면에서 사용하는 400·600·700 세 굵기의 전체 Unicode 범위를 보관하고 브라우저가 표시하는 글자에 필요한 조각만 받는다. 표지·한글 양식 미리보기와 HWPX에는 적용하지 않는다.

- 출처: [공식 dynamic-subset CSS](https://github.com/orioncactus/pretendard/blob/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/packages/pretendard-gov/dist/web/static/pretendard-gov-dynamic-subset.css), [공식 woff2 조각](https://github.com/orioncactus/pretendard/tree/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/packages/pretendard-gov/dist/web/static/woff2-dynamic-subset)
- 원본 커밋: `7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae`
- 라이선스: [SIL Open Font License 1.1 원문](https://github.com/orioncactus/pretendard/blob/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/LICENSE), 같은 폴더의 `OFL.txt`
- Regular 400: 120개 조각, 2,246,564 bytes.
- SemiBold 600: 120개 조각, 2,275,616 bytes.
- Bold 700: 120개 조각, 2,280,908 bytes.
- woff2 보관 합계: 360개 조각, 6,803,088 bytes (6.49 MiB).
- 작성 화면 첫 로딩의 실제 전송량: 작업 산출물 `shots/captions.md`와 `evidence/subset-first-writing.json` 참조.

글리프를 다시 자르거나 변형하지 않은 공식 woff2 조각이다. `pretendard-gov-dynamic-subset.css`는 공식 CSS에서 사용하지 않는 굵기와 legacy woff 소스만 제외했고 원본 `unicode-range`와 `font-display: swap`을 유지했다. `bunfig.toml`의 플러그인이 이 상대 글꼴 경로만 로컬 `/fonts/` 외부 자산으로 연결하고, Bun의 기본 디렉터리 라우트가 woff2를 제공한다. 작은 조각이 CSS data URL로 모두 합쳐지는 것을 막기 위한 설정이다. `tokens.css`가 이를 불러오며 모든 글꼴 요청은 같은 앱 서버로 향한다. 보관 합계는 다운로드 합계가 아니며 화면에 필요한 조각 수에 따라 실제 전송량이 달라진다.
