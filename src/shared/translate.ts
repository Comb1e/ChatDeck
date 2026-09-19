import type { Rect } from './types'
import { clampPoint } from './floatLayout'

/**
 * 划词翻译的纯逻辑(浏览器安全,不引入 Node 模块):
 * 语言方向解析、签名外的请求侧辅助、错误码映射、译文弹窗定位。
 * 百度 API 签名(buildSign)在主进程 translateService.ts 中用 node:crypto 实现。
 */

export type TranslatePairId =
  | 'auto'
  | 'zh-en'
  | 'en-zh'
  | 'zh-jp'
  | 'jp-zh'
  | 'zh-kor'
  | 'kor-zh'
  | 'zh-ru'
  | 'zh-fr'
  | 'zh-de'
  | 'zh-es'

/** 弹窗方向选择器的可选项;auto 的 to 由 resolveDirection 按文本动态决定 */
export const TRANSLATE_PAIRS: ReadonlyArray<{ id: TranslatePairId; from: string; to: string; label: string }> = [
  { id: 'auto', from: 'auto', to: '', label: '自动 · 中⇄英' },
  { id: 'zh-en', from: 'zh', to: 'en', label: '中 → 英' },
  { id: 'en-zh', from: 'en', to: 'zh', label: '英 → 中' },
  { id: 'zh-jp', from: 'zh', to: 'jp', label: '中 → 日' },
  { id: 'jp-zh', from: 'jp', to: 'zh', label: '日 → 中' },
  { id: 'zh-kor', from: 'zh', to: 'kor', label: '中 → 韩' },
  { id: 'kor-zh', from: 'kor', to: 'zh', label: '韩 → 中' },
  { id: 'zh-ru', from: 'zh', to: 'ru', label: '中 → 俄' },
  { id: 'zh-fr', from: 'zh', to: 'fr', label: '中 → 法' },
  { id: 'zh-de', from: 'zh', to: 'de', label: '中 → 德' },
  { id: 'zh-es', from: 'zh', to: 'es', label: '中 → 西' }
]

/** 非法/未知配置值一律回落到 auto */
export function normalizePairId(value: unknown): TranslatePairId {
  const id = typeof value === 'string' ? value : ''
  return TRANSLATE_PAIRS.some((p) => p.id === id) ? (id as TranslatePairId) : 'auto'
}

/** CJK 统一表意文字 + 假名 + 谚文(自动方向判定:含 CJK 视为源语言非英文) */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** 解析百度 API 的 from/to;auto 由本地启发式决定目标语种,from 恒为 auto 交给服务端检测 */
export function resolveDirection(pairId: string, text: string): { from: string; to: string } {
  const pair = TRANSLATE_PAIRS.find((p) => p.id === pairId)
  if (pair && pair.id !== 'auto') return { from: pair.from, to: pair.to }
  return { from: 'auto', to: CJK_RE.test(text) ? 'en' : 'zh' }
}

const LANG_LABELS: Record<string, string> = {
  auto: '自动',
  zh: '中文',
  en: '英文',
  jp: '日语',
  kor: '韩语',
  ru: '俄语',
  fr: '法语',
  de: '德语',
  es: '西语'
}

/** 方向微标,如 「英文 → 中文」;未知代码原样显示 */
export function formatDirection(from: string, to: string): string {
  return `${LANG_LABELS[from] ?? from} → ${LANG_LABELS[to] ?? to}`
}

/** 百度免费版单次请求上限 */
export const TRANSLATE_MAX_LEN = 5000

/** 选区清洗:去首尾空白、截断到百度上限;纯空白返回 null(取词失败) */
export function sanitizeSelection(text: string): string | null {
  const clean = text.trim()
  if (!clean) return null
  return clean.length > TRANSLATE_MAX_LEN ? clean.slice(0, TRANSLATE_MAX_LEN) : clean
}

/** 多段译文按原文换行拼接;没有任何 dst 返回 null */
export function joinSegments(segments: ReadonlyArray<{ dst?: string }> | undefined): string | null {
  const dst = (segments ?? [])
    .map((s) => (typeof s.dst === 'string' ? s.dst : ''))
    .filter((v) => v !== '')
    .join('\n')
  return dst || null
}

/** 百度通用翻译错误码 → 用户可读文案;未知码带上原码 */
export function describeTranslateError(code: string, fallbackMsg?: string): string {
  const map: Record<string, string> = {
    '52001': '请求超时，请重试',
    '52002': '翻译服务系统错误，请重试',
    '52003': '未授权：请检查 APPID 或在百度控制台开通通用翻译',
    '54000': '请求参数错误',
    '54001': '签名错误：请检查 APPID 与密钥是否正确',
    '54003': '请求频率超限，请稍后再试',
    '54004': '账户余额不足',
    '58001': '不支持该语言方向',
    '58002': '翻译服务当前已关闭',
    '58003': '文本超出长度限制',
    '90107': '认证失败：请检查百度账号认证状态'
  }
  return map[code] ?? fallbackMsg ?? `翻译失败（code ${code}）`
}

/** 译文弹窗尺寸(DIP) */
export const TRANSLATE_POPUP = { width: 320, height: 156 } as const

/** 弹窗与悬浮窗的间距 */
const POPUP_GAP = 8

/**
 * 弹窗定位:悬浮窗正上方水平居中;上方放不下落到正下方;
 * 仍放不下由 clampPoint 拉回工作区内(可能与悬浮窗重叠,可接受)。
 */
export function translatePopupRect(floatBounds: Rect, workArea: Rect): { x: number; y: number } {
  const { width, height } = TRANSLATE_POPUP
  const x = floatBounds.x + (floatBounds.width - width) / 2
  let y = floatBounds.y - POPUP_GAP - height
  if (y < workArea.y) {
    y = floatBounds.y + floatBounds.height + POPUP_GAP
  }
  return clampPoint(x, y, width, height, workArea)
}

/** 主进程 → 弹窗渲染层的完整状态(每次触发/完成都整包推送) */
export interface TranslatePopupState {
  status: 'translating' | 'done' | 'error'
  /** 译文(status=done) */
  dst: string
  /** 错误/引导文案(status=error) */
  message: string
  /** 方向微标,如 「英文 → 中文」 */
  dirLabel: string
  /** 当前方向对(弹窗选择器回显) */
  pairId: TranslatePairId
}

/** 划词翻译配置(translate.user.json) */
export interface TranslateConfig {
  appId: string
  appKey: string
  pair: TranslatePairId
}

export const EMPTY_TRANSLATE_CONFIG: TranslateConfig = { appId: '', appKey: '', pair: 'auto' }
