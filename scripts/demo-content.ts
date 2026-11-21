import type { SaveItemRequest } from "../src/shared/api";

// Fictional work, written in the source form's short title/bullet style.
export const demoContent: {
  week: number; department: string; writer: string; item: SaveItemRequest;
}[] = [
  { week: 2, department: "기획처", writer: "W1001", item: {
    title: [{ text: "제34차 사업실적 점검회의 준비", bold: true }],
    content: [[{ text: " ○ (내용) 본부별 11월 사업실적 및 연말 중점과제 추진현황 취합" }]],
    notes: [[{ text: "   * (일시/장소) 11. 18.(수) 14:00 / 본사 8층 회의실" }]],
    tables: [],
  } },
  { week: 2, department: "기획처", writer: "W1002", item: {
    title: [{ text: "2027년 인력운영계획 부서 의견 검토", bold: true }],
    content: [[{ text: " ○ (내용) 본사·지역본부 인력 수요 검토 및 조정안 마련" }]],
    notes: [[{ text: "   * (일정) 11. 16.(월)~11. 20.(금) / 부서별 협의" }]],
    tables: [],
  } },
  { week: 2, department: "예산법무처", writer: "W2001", item: {
    title: [{ text: "연말 예산집행 전망 보완", bold: true }],
    content: [[{ text: " ○ (내용) 기관별 집행 전망 취합 및 불용 예상액 조정 협의" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "예산법무처", writer: "W2002", item: {
    title: [{ text: "계약 법률상담 주요 사례 정리", bold: true }],
    content: [[{ text: " ○ (내용) 11. 19.(목) 계약담당자 협의용 자문 사례 6건 정리" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "AI혁신처", writer: "W3001", item: {
    title: [{ text: "「AI 캔버스」시범운영 의견 수렴", bold: true }],
    content: [[{ text: " ○ (내용) 현업 사용자 20명 대상 서비스 개선 의견 취합 및 분류" }]],
    notes: [[{ text: "   * 일정: 11. 16.(월)~11. 20.(금)" }]], tables: [],
  } },
  { week: 2, department: "AI혁신처", writer: "W3002", item: {
    title: [{ text: "AI 서비스 배포 절차 점검", bold: true }],
    content: [[{ text: " ○ (내용) 11. 18.(수) 개발소스 이력 및 시험환경 배포 절차 점검" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "정보보안운영처", writer: "W4001", item: {
    title: [{ text: "업무시스템 접근권한 정기 점검", bold: true }],
    content: [[{ text: " ○ (내용) 11. 17.(화) 인사변동자 계정 및 관리자 권한 정비" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "정보보안운영처", writer: "W4002", item: {
    title: [{ text: "재해복구 모의훈련 사전 준비", bold: true }],
    content: [[{ text: " ○ (내용) 주요 업무시스템 복구 순서 및 비상연락망 현행화" }]],
    notes: [[{ text: "   * 일정: 11. 19.(목) / 정보전산실" }]], tables: [],
  } },
  { week: 2, department: "경영성과처", writer: "W5001", item: {
    title: [{ text: "경영평가 지적사항 이행현황 점검", bold: true }],
    content: [[{ text: " ○ (내용) 11. 18.(수) 부서별 개선과제 12건의 추진실적 확인" }]],
    notes: [], tables: [],
  } },
  { week: 2, department: "경영성과처", writer: "W5002", item: {
    title: [{ text: "성과지표 산출근거 자료 취합", bold: true }],
    content: [[{ text: " ○ (내용) 비계량 지표별 증빙 목록 정리 및 누락자료 보완" }]],
    notes: [[{ text: "   * 일정: 11. 16.(월)~11. 20.(금)" }]], tables: [],
  } },
  { week: 3, department: "기획처", writer: "W1001", item: {
    title: [{ text: "12월 중점 추진과제 조정회의", bold: true }],
    content: [[{ text: " ○ (내용) 연말 주요 일정 및 부서 간 협업과제 추진계획 조정" }]],
    notes: [[{ text: "   * (일시/장소) 11. 25.(수) 14:00 / 본사 8층 회의실" }]],
    tables: [],
  } },
  { week: 3, department: "기획처", writer: "W1003", item: {
    title: [{ text: "국토교통부 업무보고 자료 보완", bold: true }],
    content: [[{ text: " ○ (내용) 11. 27.(금) 제출용 주요 사업성과 및 차년도 추진계획 정리" }]],
    notes: [[{ text: "   * (대상) 본사 실·처 및 지역본부" }]], tables: [],
  } },
  { week: 3, department: "예산법무처", writer: "W2001", item: {
    title: [{ text: "2027년도 예산편성 조정회의", bold: true }],
    content: [[{ text: " ○ (내용) 정보화사업 예산 조정안 검토 및 부서별 요구사항 협의" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "예산법무처", writer: "W2003", item: {
    title: [{ text: "계약서 표준 조항 검토", bold: true }],
    content: [[{ text: " ○ (내용) 11. 26.(목) 정보화 용역계약의 개인정보 보호 조항 검토" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "AI혁신처", writer: "W3001", item: {
    title: [{ text: "「AI 캔버스」개선과제 우선순위 확정", bold: true }],
    content: [[{ text: " ○ (내용) 시범운영 의견 8건 검토 및 12월 적용 대상 선정" }]],
    notes: [[{ text: "   * 일정: 11. 24.(화)~11. 27.(금)" }]], tables: [],
  } },
  { week: 3, department: "AI혁신처", writer: "W3003", item: {
    title: [{ text: "AI 활용 실무교육 자료 점검", bold: true }],
    content: [[{ text: " ○ (내용) 11. 25.(수) 현업 실습 예제 및 서비스 이용 안내 보완" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "정보보안운영처", writer: "W4001", item: {
    title: [{ text: "재해복구 모의훈련 실시", bold: true }],
    content: [[{ text: " ○ (내용) 주요 시스템 백업자료 복구 및 업무 재개 절차 확인" }]],
    notes: [[{ text: "   * (일시/장소) 11. 25.(수) 16:00 / 정보전산실" }]], tables: [],
  } },
  { week: 3, department: "정보보안운영처", writer: "W4003", item: {
    title: [{ text: "연말 정보보안 자체점검 안내", bold: true }],
    content: [[{ text: " ○ (내용) 11. 23.(월) 부서별 보안점검표 배포 및 제출일정 안내" }]],
    notes: [], tables: [],
  } },
  { week: 3, department: "경영성과처", writer: "W5001", item: {
    title: [{ text: "경영평가 개선과제 실적 검증", bold: true }],
    content: [[{ text: " ○ (내용) 부서 제출 증빙자료 확인 및 미완료 과제 조치계획 협의" }]],
    notes: [[{ text: "   * 일정: 11. 24.(화)~11. 26.(목)" }]], tables: [],
  } },
  { week: 3, department: "경영성과처", writer: "W5003", item: {
    title: [{ text: "2027년 성과지표 조정안 마련", bold: true }],
    content: [[{ text: " ○ (내용) 11. 27.(금) 부서 협의용 지표 정의서 및 산출기준 정리" }]],
    notes: [], tables: [],
  } },
];

export const liveReturnMessage = "조정회의 개최일을 내용에 추가해 주세요. 11. 25.(수)로 협의된 일정을 명시하면 됩니다.";

export const demoReturns: {
  week: number; department: string; title: string; unit: "item" | "section";
  message: string; line: string; note?: string;
}[] = [
  {
    week: 1, department: "기획처", title: "2026년 11월 국토교통위원회 전", unit: "item",
    message: "국토위 예산안 상정에 대비해 준비할 자료의 범위를 적어 주세요.",
    line: " ○ (준비자료) 2027년도 위탁사업 예산안 및 주요 법안 검토자료 취합",
    note: "국토위 상정 준비자료를 위탁사업 예산안과 주요 법안 검토자료로 구체화했습니다.",
  },
  {
    week: 1, department: "AI혁신처", title: "AI 서비스 개발소스·배포", unit: "item",
    message: "개발소스와 배포 절차를 어떤 범위에서 점검하는지 명시해 주세요.",
    line: " ○ (점검범위) AI 서비스 3종의 소스 변경이력 및 시험환경 배포 절차 확인",
  },
  {
    week: 1, department: "예산법무처", title: "연말 예산집행", unit: "section",
    message: "「연말 예산집행」의 12월 집행 전망을 확인한 뒤 어느 부서와 조정할지 적어 주세요.",
    line: " ○ (후속조치) 12월 집행 전망 검토 결과를 사업부서 예산담당자와 공유·조정",
    note: "실 검토 의견에 따라 12월 집행 전망의 공유 대상과 조정 절차를 명시했습니다.",
  },
  {
    week: 2, department: "예산법무처", title: "연말 예산집행 전망 보완", unit: "item",
    message: "집행 전망의 검토 기준일과 대상 기관 수를 추가해 주세요.",
    line: " ○ (기준) 11. 18.(수) 기준, 12개 기관 집행 전망 검토",
    note: "집행 전망의 기준일을 11월 18일로, 검토 대상을 12개 기관으로 명시했습니다.",
  },
  {
    week: 2, department: "경영성과처", title: "경영평가 지적사항 이행현황 점검", unit: "item",
    message: "개선과제 12건의 실적을 어떤 자료로 확인할지 적어 주세요.",
    line: " ○ (확인자료) 과제별 조치결과 보고서 및 개선 전·후 증빙 대조",
  },
  {
    week: 2, department: "AI혁신처", title: "「AI 캔버스」시범운영 의견 수렴", unit: "section",
    message: "「AI 캔버스」시범운영 의견을 개선과제로 연결할 수 있도록 분류 기준을 적어 주세요.",
    line: " ○ (분류) 사용자 의견을 기능·사용성·오류로 구분하여 개선과제 목록 작성",
    note: "실 검토 의견을 반영해 시범운영 의견의 분류 기준과 정리 방법을 추가했습니다.",
  },
];

export const demoResults: {
  week: number; department: string; title: string; content: SaveItemRequest["content"];
}[] = [
  { week: 2, department: "기획처", title: "2026년 11월 국토교통위원회 전", content: [
    [{ text: " ○ (실적) 11. 12.(목) 국토위 예산안 상정 대응자료 취합 및 수행 지원 완료" }],
    [{ text: " ○ (결과) 2027년도 위탁사업 예산안 및 주요 법안 검토자료 관계부서 공유" }],
  ] },
  { week: 2, department: "예산법무처", title: "연말 예산집행", content: [
    [{ text: " ○ (실적) 12월 예산집행 전망 취합 완료 및 사업손익 추정자료 작성" }],
    [{ text: " ○ (결과) 불용 예상 사업 3건을 소관 사업부서와 협의·조정" }],
  ] },
  { week: 2, department: "AI혁신처", title: "AI 서비스 개발소스·배포", content: [
    [{ text: " ○ (실적) AI 서비스 3종의 소스 변경이력 및 시험환경 배포 절차 점검 완료" }],
    [{ text: " ○ (결과) 배포 점검표 누락사항 2건 보완 및 담당자 안내" }],
  ] },
  { week: 3, department: "기획처", title: "제34차 사업실적 점검회의 준비", content: [
    [{ text: " ○ (실적) 11. 18.(수) 사업실적 점검회의 개최 및 본부별 연말 과제 확인" }],
    [{ text: " ○ (결과) 지연 과제 3건의 조치계획 취합 및 회의결과 배포 완료" }],
  ] },
  { week: 3, department: "정보보안운영처", title: "업무시스템 접근권한 정기 점검", content: [
    [{ text: " ○ (실적) 11. 17.(화) 인사변동자 계정 14건 및 관리자 권한 점검 완료" }],
    [{ text: " ○ (결과) 미사용 계정 2건 회수 및 권한 정비내역 기록" }],
  ] },
  { week: 3, department: "경영성과처", title: "경영평가 지적사항 이행현황 점검", content: [
    [{ text: " ○ (실적) 11. 18.(수) 개선과제 12건의 조치결과 보고서와 증빙 대조 완료" }],
    [{ text: " ○ (결과) 완료 10건 확인, 진행 2건의 보완일정 소관 부서 협의" }],
  ] },
];

export const demoPublicationFix = {
  department: "기획처", title: "2026년 11월 국토교통위원회 전",
  line: " ○ (보완) 국토위 예산안 검토자료를 지역본부 기획담당자에게 추가 배포",
  note: "배포 후 국토위 예산안 검토자료의 공유 대상을 지역본부까지 보완했습니다.",
};
