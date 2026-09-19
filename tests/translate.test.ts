import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// translateService 经 JsonStore 间接依赖 electron;纯函数测试只需可导入
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/chatdeck-test' } }))

import {
  TRANSLATE_PAIRS,
  TRANSLATE_POPUP,
  describeTranslateError,
  formatDirection,
  joinSegments,
  normalizePairId,
  resolveDirection,
  sanitizeSelection,
  translatePopupRect
} from '@shared/translate'
import { buildSign } from '../src/main/translateService'

describe('TRANSLATE_PAIRS', () => {
  it('id 唯一且 label 非空', () => {
    const ids = TRANSLATE_PAIRS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TRANSLATE_PAIRS) expect(p.label.length).toBeGreaterThan(0)
  })

  it('包含 auto 与显式语言对,显式对 from/to 均非空且不同', () => {
    const auto = TRANSLATE_PAIRS.find((p) => p.id === 'auto')
    expect(auto).toBeDefined()
    const explicit = TRANSLATE_PAIRS.filter((p) => p.id !== 'auto')
    expect(explicit.length).toBeGreaterThanOrEqual(8)
    for (const p of explicit) {
      expect(p.from).not.toBe('')
      expect(p.to).not.toBe('')
      expect(p.from).not.toBe(p.to)
    }
  })
})

describe('normalizePairId', () => {
  it('合法 id 原样返回,非法/非字符串回落 auto', () => {
    expect(normalizePairId('en-zh')).toBe('en-zh')
    expect(normalizePairId('zh-jp')).toBe('zh-jp')
    expect(normalizePairId('bogus')).toBe('auto')
    expect(normalizePairId(undefined)).toBe('auto')
    expect(normalizePairId(42)).toBe('auto')
  })
})

describe('resolveDirection', () => {
  it('auto:英文文本 → 目标中文', () => {
    expect(resolveDirection('auto', 'Hello world')).toEqual({ from: 'auto', to: 'zh' })
  })

  it('auto:中文文本 → 目标英文', () => {
    expect(resolveDirection('auto', '你好，世界')).toEqual({ from: 'auto', to: 'en' })
  })

  it('auto:中英混合按含 CJK 判定 → 英', () => {
    expect(resolveDirection('auto', 'mix 混合 text')).toEqual({ from: 'auto', to: 'en' })
  })

  it('auto:数字与标点视为英文方向 → 中', () => {
    expect(resolveDirection('auto', '12345 !!! v2.0')).toEqual({ from: 'auto', to: 'zh' })
  })

  it('auto:假名/谚文按 CJK 处理 → 英(建议改用显式语言对)', () => {
    expect(resolveDirection('auto', 'こんにちは')).toEqual({ from: 'auto', to: 'en' })
    expect(resolveDirection('auto', '안녕하세요')).toEqual({ from: 'auto', to: 'en' })
  })

  it('auto:空文本回落 → 中', () => {
    expect(resolveDirection('auto', '')).toEqual({ from: 'auto', to: 'zh' })
  })

  it('显式语言对原样直传,不受文本影响', () => {
    expect(resolveDirection('zh-jp', 'Hello')).toEqual({ from: 'zh', to: 'jp' })
    expect(resolveDirection('jp-zh', '你好')).toEqual({ from: 'jp', to: 'zh' })
  })

  it('未知 pairId 回落 auto 行为', () => {
    expect(resolveDirection('nope', 'hello')).toEqual({ from: 'auto', to: 'zh' })
  })
})

describe('formatDirection', () => {
  it('已知代码映射为中文标签', () => {
    expect(formatDirection('en', 'zh')).toBe('英文 → 中文')
    expect(formatDirection('auto', 'jp')).toBe('自动 → 日语')
  })

  it('未知代码原样显示', () => {
    expect(formatDirection('xx', 'zh')).toBe('xx → 中文')
  })
})

describe('sanitizeSelection', () => {
  it('去首尾空白', () => {
    expect(sanitizeSelection('  hello world  ')).toBe('hello world')
  })

  it('纯空白返回 null', () => {
    expect(sanitizeSelection('   \n\t ')).toBeNull()
    expect(sanitizeSelection('')).toBeNull()
  })

  it('超长截断到 5000', () => {
    expect(sanitizeSelection('a'.repeat(6000))).toHaveLength(5000)
    expect(sanitizeSelection('a'.repeat(5000))).toHaveLength(5000)
  })
})

describe('joinSegments', () => {
  it('多段按换行拼接', () => {
    expect(joinSegments([{ dst: '你好' }, { dst: '世界' }])).toBe('你好\n世界')
  })

  it('单段/无段/缺 dst', () => {
    expect(joinSegments([{ dst: 'hi' }])).toBe('hi')
    expect(joinSegments(undefined)).toBeNull()
    // 百度实际返回 {src,dst};模拟 dst 缺失的段
    expect(joinSegments([{ src: 'x' } as { dst?: string }])).toBeNull()
    expect(joinSegments([{ dst: '' }])).toBeNull()
  })
})

describe('describeTranslateError', () => {
  it('已知码映射为可读文案', () => {
    expect(describeTranslateError('54001')).toContain('签名')
    expect(describeTranslateError('52003')).toContain('APPID')
    expect(describeTranslateError('54003')).toContain('频率')
  })

  it('未知码回退:优先 error_msg,否则带原码', () => {
    expect(describeTranslateError('99999')).toContain('99999')
    expect(describeTranslateError('99999', '服务异常')).toBe('服务异常')
  })
})

describe('buildSign', () => {
  it('符合 MD5 已知向量(校验拼接顺序:appid+q+salt+key)', () => {
    // md5('') 与 md5('abc') 的公开已知值
    expect(buildSign('', '', '', '')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(buildSign('', 'abc', '', '')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })

  it('输出 32 位小写 hex 且与 node:crypto 直算一致', () => {
    const sign = buildSign('20260302', 'hello world', '1720000000000', 'secret')
    expect(sign).toMatch(/^[0-9a-f]{32}$/)
    expect(sign).toBe(createHash('md5').update('20260302hello world1720000000000secret').digest('hex'))
  })
})

describe('translatePopupRect', () => {
  const POPUP = TRANSLATE_POPUP

  it('默认:悬浮窗正上方水平居中,间距 8px', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    const float = { x: 800, y: 500, width: 360, height: 620 }
    expect(translatePopupRect(float, area)).toEqual({ x: 820, y: 500 - 8 - POPUP.height })
  })

  it('顶部空间不足 → 落到正下方', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    const float = { x: 800, y: 100, width: 360, height: 620 }
    expect(translatePopupRect(float, area)).toEqual({ x: 820, y: 100 + 620 + 8 })
  })

  it('药丸悬浮窗窄于弹窗:居中 x 为负时夹取到工作区左缘', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    const float = { x: 0, y: 500, width: 148, height: 64 }
    const r = translatePopupRect(float, area)
    expect(r.x).toBe(0)
    expect(r.y).toBe(500 - 8 - POPUP.height)
  })

  it('负坐标副屏:正常夹取不跑主屏', () => {
    const area = { x: -1920, y: 0, width: 1920, height: 1040 }
    const float = { x: -1200, y: 500, width: 360, height: 620 }
    expect(translatePopupRect(float, area)).toEqual({ x: -1180, y: 500 - 8 - POPUP.height })
  })

  it('工作区退化(小于弹窗):钳到工作区原点不越界', () => {
    const area = { x: 0, y: 0, width: 100, height: 100 }
    const float = { x: 0, y: 0, width: 360, height: 620 }
    expect(translatePopupRect(float, area)).toEqual({ x: 0, y: 0 })
  })
})
