import { createHash } from 'node:crypto'
import {
  EMPTY_TRANSLATE_CONFIG,
  describeTranslateError,
  formatDirection,
  joinSegments,
  normalizePairId,
  resolveDirection,
  sanitizeSelection
} from '@shared/translate'
import type { TranslateConfig, TranslatePairId } from '@shared/translate'
import { JsonStore } from './store/jsonStore'

const API_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
const REQUEST_TIMEOUT_MS = 15_000
/** 免费标准版 QPS=1:相邻两次请求起点至少间隔 1.1s */
const MIN_REQUEST_INTERVAL_MS = 1_100

/** sign = MD5(appid + q + salt + key),小写 hex;q 用原文参与拼接(编码由 URLSearchParams 负责) */
export function buildSign(appid: string, q: string, salt: string, key: string): string {
  return createHash('md5').update(appid + q + salt + key).digest('hex')
}

interface BaiduSegment {
  src?: string
  dst?: string
}

interface BaiduResponse {
  from?: string
  to?: string
  trans_result?: BaiduSegment[]
  error_code?: string
  error_msg?: string
}

export type TranslateOutcome =
  | { ok: true; dst: string; dirLabel: string }
  | { ok: false; message: string }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 百度通用翻译客户端 + 本地配置存取(translate.user.json)。
 * 请求串行化以满足免费版 QPS=1;凭据只落 userData,不进源码。
 */
export class TranslateService {
  private store = new JsonStore<TranslateConfig>('translate.user.json', EMPTY_TRANSLATE_CONFIG)
  private config: TranslateConfig = { ...EMPTY_TRANSLATE_CONFIG }
  private queue: Promise<unknown> = Promise.resolve()
  private lastCallAt = 0
  private writeQueue: Promise<void> = Promise.resolve()

  async init(): Promise<void> {
    const s = await this.store.load()
    this.config = {
      appId: typeof s.appId === 'string' ? s.appId.trim() : '',
      appKey: typeof s.appKey === 'string' ? s.appKey.trim() : '',
      pair: normalizePairId(s.pair)
    }
  }

  getConfig(): TranslateConfig {
    return { ...this.config }
  }

  hasCredentials(): boolean {
    return this.config.appId !== '' && this.config.appKey !== ''
  }

  async saveConfig(input: { appId?: string; appKey?: string }): Promise<TranslateConfig> {
    if (typeof input?.appId === 'string') this.config.appId = input.appId.trim()
    if (typeof input?.appKey === 'string') this.config.appKey = input.appKey.trim()
    await this.persist()
    return this.getConfig()
  }

  async setPair(pair: unknown): Promise<TranslatePairId> {
    this.config.pair = normalizePairId(pair)
    await this.persist()
    return this.config.pair
  }

  /** 对外入口:串行执行,永远不抛出(失败以结果表达) */
  translate(text: string): Promise<TranslateOutcome> {
    const task = this.queue.then(() => this.runTranslate(text))
    this.queue = task.catch(() => {})
    return task
  }

  private async runTranslate(text: string): Promise<TranslateOutcome> {
    const clean = sanitizeSelection(text)
    if (!clean) return { ok: false, message: '未取到选中文本' }
    if (!this.hasCredentials()) {
      return { ok: false, message: '未配置百度翻译：请在主窗口设置中填写 APPID/KEY' }
    }

    const gap = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastCallAt)
    if (gap > 0) await sleep(gap)

    const { from, to } = resolveDirection(this.config.pair, clean)
    const salt = Date.now().toString()
    const params = new URLSearchParams({
      q: clean,
      from,
      to,
      appid: this.config.appId,
      salt,
      sign: buildSign(this.config.appId, clean, salt, this.config.appKey)
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    this.lastCallAt = Date.now()
    try {
      const res = await fetch(`${API_URL}?${params.toString()}`, { signal: controller.signal })
      const data = (await res.json()) as BaiduResponse
      if (data.error_code) {
        return { ok: false, message: describeTranslateError(data.error_code, data.error_msg) }
      }
      const dst = joinSegments(data.trans_result)
      if (!dst) return { ok: false, message: '翻译服务未返回译文' }
      return {
        ok: true,
        dst,
        dirLabel: formatDirection(data.from ?? from, data.to ?? to)
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      return { ok: false, message: aborted ? '翻译请求超时' : '翻译请求失败：网络异常' }
    } finally {
      clearTimeout(timer)
    }
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.store.save({ ...this.config })).catch(() => {})
    return this.writeQueue
  }
}
