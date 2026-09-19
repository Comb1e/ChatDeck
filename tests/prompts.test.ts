import { describe, expect, it } from 'vitest'
import { extractPlaceholders, hasPlaceholders, renderContent } from '@shared/prompts'

describe('extractPlaceholders', () => {
  it('按出现顺序提取并去重', () => {
    expect(extractPlaceholders('把 {内容} 翻译成 {语言}，{内容} 保持一致')).toEqual(['内容', '语言'])
  })

  it('无占位符返回空数组', () => {
    expect(extractPlaceholders('普通文本')).toEqual([])
  })

  it('跨行与空占位符被忽略', () => {
    expect(extractPlaceholders('{\n多行不算}\n{}')).toEqual([])
  })

  it('占位符名去除首尾空格', () => {
    expect(extractPlaceholders('{ 内容 }')).toEqual(['内容'])
  })
})

describe('renderContent', () => {
  it('替换已填写的占位符', () => {
    expect(renderContent('请把 {内容} 翻译成 {语言}', { 内容: '你好', 语言: '英语' })).toBe(
      '请把 你好 翻译成 英语'
    )
  })

  it('缺失的占位符保留原文', () => {
    expect(renderContent('请把 {内容} 翻译成 {语言}', { 内容: '你好' })).toBe(
      '请把 你好 翻译成 {语言}'
    )
  })

  it('空字符串值视为未填写', () => {
    expect(renderContent('A{变量}B', { 变量: '' })).toBe('A{变量}B')
  })

  it('值中的 $ 符号不触发替换模式', () => {
    expect(renderContent('价格：{金额}', { 金额: '$&$1$$' })).toBe('价格：$&$1$$')
  })
})

describe('hasPlaceholders', () => {
  it('判断占位符存在', () => {
    expect(hasPlaceholders('x {内容} y')).toBe(true)
    expect(hasPlaceholders('无占位符')).toBe(false)
  })
})
