import { plainText, type RichText, type WorkCategory } from "./weekly-plan";

// Template: 12pt = 1200 HWPUNIT per full-width character; reserve 2404 for numbering.
// Narrow cell: 25891 - 138 - 138. Ongoing: 51782 - 850 - 140 - 500 (paragraph right).
const titleLimits = {
  lastWeek: Math.floor((25891 - 138 - 138 - 2404) / 1200),
  thisWeek: Math.floor((25891 - 138 - 138 - 2404) / 1200),
  ongoing: Math.floor((51782 - 850 - 140 - 500 - 2404) / 1200),
} as const;

export function titleError(title: RichText, category: WorkCategory): string | undefined {
  const text = plainText(title), limit = titleLimits[category];
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text))
    return "제목에는 줄바꿈이나 탭 등 제어 문자를 넣을 수 없습니다.";
  if (Array.from(text).length > limit)
    return `제목은 한글 양식의 한 줄에 맞게 ${limit}자 이내로 입력하세요.`;
}
