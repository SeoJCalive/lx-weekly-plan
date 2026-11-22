# 화면용 Pretendard GOV

외부 접속이 막힌 PC에서도 화면 글꼴을 읽을 때 쓰는 공식 배포본이다. 화면에서 사용하는 400·600·700 세 굵기만 포함하며 표지·한글 양식 미리보기와 HWPX에는 적용하지 않는다.

- 출처: [orioncactus/pretendard](https://github.com/orioncactus/pretendard/tree/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/packages/pretendard-gov/dist/web/static/woff2)
- 원본 커밋: `7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae`
- 라이선스: [SIL Open Font License 1.1 원문](https://github.com/orioncactus/pretendard/blob/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/LICENSE), 같은 폴더의 `OFL.txt`
- Regular 400: 2,043,316 bytes, SHA-256 `0707d52d277a20d807f472559940e7f8022e528ac4c680b827287938d4db1fbe`
- SemiBold 600: 2,097,796 bytes, SHA-256 `d49137fa54e9b5396c35e0b800413df0a0eb8c51f187d4d0d0ea93c77f7dcf1e`
- Bold 700: 2,120,680 bytes, SHA-256 `d78ab7c3708fe868dcc5e3696281771b3cdc6a891de571f93331f98840d8941b`
- 합계: 6,261,792 bytes (5.97 MiB)

글리프를 다시 자르거나 변형하지 않은 정적 woff2다. `tokens.css`의 `@font-face`가 같은 서버의 자산으로 제공하고 `font-display: swap`으로 불러온다.
