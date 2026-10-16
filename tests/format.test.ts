import { describe, expect, it } from 'vitest'
import { josa, won } from '../src/lib/format'

describe('글자 도우미', () => {
  it('받침에 따라 이/가, 을/를', () => {
    expect(josa('남편', '이', '가')).toBe('이')
    expect(josa('아내', '이', '가')).toBe('가')
    expect(josa('대파', '을', '를')).toBe('를')
    expect(josa('비비고 왕교자', '을', '를')).toBe('를')
    expect(josa('삼겹살', '을', '를')).toBe('을')
  })
  it('금액은 천 단위 쉼표와 원', () => {
    expect(won(3480)).toBe('3,480원')
  })
})
