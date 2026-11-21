import type { SaveItemRequest } from "../src/shared/api";

// Fictional work, written in the source form's short title/bullet style.
export const demoContent: {
  week: number; department: string; writer: string; item: SaveItemRequest;
}[] = [
  { week: 2, department: "기획처", writer: "W1001", item: {
    title: [{ text: "제34차 실적회의 준비", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "본부별 실적과 중점과제 취합" }]],
    notes: [[{ text: "   * 11.18.(수) 14시 / 본사" }]],
    tables: [],
  } },
  { week: 2, department: "기획처", writer: "W1002", item: {
    title: [{ text: "2027년 인력계획 검토", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "인력 수요와 조정안 검토" }]],
    notes: [[{ text: "   * 11.16.(월)~20.(금) 협의" }]],
    tables: [],
  } },
  { week: 2, department: "예산법무처", writer: "W2001", item: {
    title: [{ text: "연말 예산집행 전망 보완", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "기관별 집행 전망 검토" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "예산법무처", writer: "W2002", item: {
    title: [{ text: "계약 자문사례 정리", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "계약 자문사례 6건 정리" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "AI혁신처", writer: "W3001", item: {
    title: [{ text: "AI 캔버스 의견 수렴", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "현업 사용자 의견 취합" }]],
    notes: [[{ text: "   * 11.16.(월)~20.(금)" }]], tables: [],
  } },
  { week: 2, department: "AI혁신처", writer: "W3002", item: {
    title: [{ text: "AI 배포 절차 점검", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "개발소스와 배포 절차 점검" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "정보보안운영처", writer: "W4001", item: {
    title: [{ text: "접근권한 정기 점검", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "인사변동자 접근권한 정비" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "정보보안운영처", writer: "W4002", item: {
    title: [{ text: "재해복구 훈련 준비", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "복구 순서와 연락망 정비" }]],
    notes: [[{ text: "   * 11.19.(목) / 전산실" }]], tables: [],
  } },
  { week: 2, department: "경영성과처", writer: "W5001", item: {
    title: [{ text: "평가 지적사항 이행 점검", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "개선과제 12건 실적 확인" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "경영성과처", writer: "W5002", item: {
    title: [{ text: "성과지표 증빙 취합", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "지표별 증빙과 누락자료 정리" }]],
    notes: [[{ text: "   * 11.16.(월)~20.(금)" }]], tables: [],
  } },
  { week: 3, department: "기획처", writer: "W1001", item: {
    title: [{ text: "12월 중점과제 조정회의", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "연말 일정과 협업과제 조정" }]],
    notes: [[{ text: "   * 11.25.(수) 14시 / 본사" }]],
    tables: [],
  } },
  { week: 3, department: "기획처", writer: "W1003", item: {
    title: [{ text: "국토부 업무보고 보완", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "사업성과와 차년도 계획 정리" }]],
    notes: [[{ text: "   * 본사 실·처 및 지역본부" }]], tables: [],
  } },
  { week: 3, department: "예산법무처", writer: "W2001", item: {
    title: [{ text: "2027년 예산조정회의", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "사업별 예산 조정안 검토" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "예산법무처", writer: "W2003", item: {
    title: [{ text: "계약서 표준 조항 검토", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "개인정보 보호 조항 검토" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "AI혁신처", writer: "W3001", item: {
    title: [{ text: "AI 캔버스 과제 확정", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "시범운영 개선과제 8건 선정" }]],
    notes: [[{ text: "   * 11.24.(화)~27.(금)" }]], tables: [],
  } },
  { week: 3, department: "AI혁신처", writer: "W3003", item: {
    title: [{ text: "AI 실무교육 자료 점검", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "현업 실습예제와 안내 보완" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "정보보안운영처", writer: "W4001", item: {
    title: [{ text: "재해복구 모의훈련 실시", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "백업 복구와 업무 재개 점검" }]],
    notes: [[{ text: "   * 11.25.(수) 16시 / 전산실" }]], tables: [],
  } },
  { week: 3, department: "정보보안운영처", writer: "W4003", item: {
    title: [{ text: "연말 정보보안 점검 안내", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "보안점검표와 제출일정 안내" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "경영성과처", writer: "W5001", item: {
    title: [{ text: "경영평가 실적 검증", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "미완료 과제 조치계획 협의" }]],
    notes: [[{ text: "   * 11.24.(화)~26.(목)" }]], tables: [],
  } },
  { week: 3, department: "경영성과처", writer: "W5003", item: {
    title: [{ text: "2027년 성과지표 조정", bold: true }],
    content: [[{ text: " ○ (내용) " }, { text: "성과지표 정의와 산출기준 정리" }]],
    notes: [], tables: [],
  } },
];

export const liveReturnMessage = "조정회의 개최일을 내용에 적어 주세요. 11.25.(수)로 협의된 일정입니다.";

export const demoReturns: {
  week: number; department: string; title: string; unit: "item" | "section";
  message: string; line: string; note?: string;
}[] = [
  {
    week: 1, department: "기획처", title: "2026년 11월 국토교통위원회 전", unit: "item",
    message: "국토위 대응자료의 검토 대상을 예산안과 법안으로 명확히 적어 주세요.",
    line: "2027년 예산안·법안 검토",
    note: "국토위 대응자료의 검토 대상을 예산안과 법안으로 구체화했습니다.",
  },
  {
    week: 1, department: "AI혁신처", title: "AI 서비스 개발소스·배포", unit: "item",
    message: "소스와 배포 이력을 점검한다는 뜻이 드러나도록 고쳐 주세요.",
    line: "AI 소스·배포 이력 점검",
  },
  {
    week: 1, department: "예산법무처", title: "연말 예산집행", unit: "section",
    message: "「연말 예산집행」의 12월 집행 전망을 사업부서와 조정한다는 뜻으로 고쳐 주세요.",
    line: " 12월 집행 전망을 사업부서와 조정",
    note: "실 검토 의견에 따라 집행 전망의 조정 대상을 사업부서로 명확히 했습니다.",
  },
  {
    week: 2, department: "예산법무처", title: "연말 예산집행 전망 보완", unit: "item",
    message: "집행 전망의 검토 대상이 12개 기관임을 명확히 적어 주세요.",
    line: "12개 기관 집행 전망 검토",
    note: "집행 전망 문구를 12개 기관의 전망을 검토한다는 뜻으로 고쳤습니다.",
  },
  {
    week: 2, department: "경영성과처", title: "평가 지적사항 이행 점검", unit: "item",
    message: "실적을 조치보고서와 증빙으로 대조한다는 뜻을 적어 주세요.",
    line: "조치보고서와 증빙 대조",
  },
  {
    week: 2, department: "AI혁신처", title: "AI 캔버스 의견 수렴", unit: "section",
    message: "시범운영 의견을 기능·사용성·오류로 나눠 정리한다는 뜻으로 고쳐 주세요.",
    line: "기능·사용성·오류별 의견 분류",
    note: "실 검토 의견에 따라 사용자 의견의 분류 기준을 명확히 했습니다.",
  },
];

export const demoResults: {
  week: number; department: string; title: string; line: string;
}[] = [
  { week: 2, department: "기획처", title: "2026년 11월 국토교통위원회 전",
    line: "국토위 예산안 대응자료 공유" },
  { week: 2, department: "예산법무처", title: "연말 예산집행",
    line: " 12월 집행 전망 조정 완료" },
  { week: 2, department: "AI혁신처", title: "AI 서비스 개발소스·배포",
    line: "AI 소스·배포 점검 완료" },
  { week: 3, department: "기획처", title: "제34차 실적회의 준비",
    line: "실적회의 개최와 조치계획 공유" },
  { week: 3, department: "정보보안운영처", title: "접근권한 정기 점검",
    line: "계정 14건 점검·2건 회수" },
  { week: 3, department: "경영성과처", title: "평가 지적사항 이행 점검",
    line: "10건 완료·2건 보완일정 협의" },
];

export const demoPublicationFix = {
  department: "기획처", title: "2026년 11월 국토교통위원회 전",
  line: "2027년 예산안·법안 공유",
  note: "배포 후 국토위 대응 문구를 예산안과 법안의 공유 결과로 고쳤습니다.",
};
