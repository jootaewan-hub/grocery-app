// 화면 글자 도우미.

const won0 = new Intl.NumberFormat('ko-KR')

// 금액은 출처가 있는 값만 넘긴다. 0이나 음수는 부르는 쪽에서 거른다.
export function won(n: number): string {
  return `${won0.format(n)}원`
}

// 받침 있으면 a(이·을), 없으면 b(가·를). 한글이 아니면 a.
export function josa(word: string, a: string, b: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return a
  return code % 28 === 0 ? b : a
}
