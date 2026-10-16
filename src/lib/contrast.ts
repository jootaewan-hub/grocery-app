/** WCAG 2.x 상대 휘도. 입력은 #RRGGBB */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`#RRGGBB 형식이 아니다: ${hex}`)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 두 색의 대비비(1~21). 글자 4.5 이상이 기준 */
export function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
