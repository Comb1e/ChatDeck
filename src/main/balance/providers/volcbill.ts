/**
 * 火山引擎计费中心账单——对应控制台「财务 → 账单管理 → 账单总览」页
 * (console.volcengine.com/finance/bill/survey)的数据源。
 *
 * 协议(官方《签名机制》docs.volcengine.com/docs/6369/67269,并经本机 2026-09 探针实测):
 * - GET https://billing.volcengineapi.com/?Action=ListBillDetail&Version=2022-01-01&…
 *   BillPeriod=YYYY-MM(单月,最多回溯 24 个月)、GroupTerm=2(按产品,GroupPeriod 必填搭配)
 *   GroupPeriod=1(按天汇总)、Limit≤300 + Offset 分页、NeedRecordNum=1(返回 Total)、
 *   IgnoreZero=1;签名为原始字节派生链(与 volcark 一致,hex 串变体实测 SignatureDoesNotMatch)
 * - 鉴权:火山 SigV4 GET 查询串版(SignedHeaders=host;x-date,service=billing),
 *   与 volcark 共用同一套 IAM AK/SK;查账单另需计费中心账单只读权限
 *   (子账号需 BillingCenterBillReadOnlyAccess,主账号天然可查)
 * - 响应:Result.List[]{ ExpenseDate(YYYY-MM-DD), PayableAmount(字符串,应付金额),
 *   Currency, Product },Result.Total 为总行数;失败在 ResponseMetadata.Error
 * - 金额口径取 PayableAmount(应付金额),与账单总览页一致
 *
 * 该数据只进账单明细窗口(经 BillDb 入库);余额小窗的 coding plan 百分比显示
 * (volcark.getBalance 的 PCT 轮询)完全不受影响。
 */
import { ApiError, AuthError, parseBalance, requestJson, shapeOf } from './base'
import {
  EMPTY_SHA256,
  classifyError,
  deriveSigningKey,
  signStringToSign,
  utcStamp,
  uriEncode
} from './volcsig'
import type { VolcEnvelope } from './volcsig'
import type { BillRowInput } from '../billdb'

const ACTION = 'ListBillDetail'
const API_VERSION = '2022-01-01'
const HOST = 'billing.volcengineapi.com'
const REGION = 'cn-beijing' // 账单为非地域型服务,官方示例即用 cn-beijing
const SERVICE = 'billing'
/** 单页上限(官方 [1,300]);按天汇总后每月行数很小,通常一页取完 */
const PAGE_LIMIT = 300
/** 分页保险丝:按 300 行/页,50 页足够覆盖任何异常膨胀的响应 */
const MAX_PAGES = 50
/** 请求间隔:计费中心明细接口限流 5 QPS,留足余量 */
const THROTTLE_MS = 200

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 火山 SigV4 GET 查询串版签名,独立纯函数便于对照测试。
 * canonicalRequest = GET / {排序编码后的查询串} {host 头} {x-date 头} '' host;x-date {空体哈希}
 */
export function signVolcQueryRequest(cfg: {
  params: Record<string, string>
  ak: string
  sk: string
  region: string
  service: string
  host: string
  now: Date
}): { url: string; headers: Record<string, string> } {
  const xDate = utcStamp(cfg.now)
  const dateStamp = xDate.slice(0, 8)
  const pairs = Object.entries(cfg.params).map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const canonicalQuery = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  const canonicalRequest = [
    'GET',
    '/',
    canonicalQuery,
    `host:${cfg.host}`,
    `x-date:${xDate}`,
    '',
    'host;x-date',
    EMPTY_SHA256
  ].join('\n')
  const scope = `${dateStamp}/${cfg.region}/${cfg.service}/request`
  const key = deriveSigningKey(cfg.sk, dateStamp, cfg.region, cfg.service)
  const signature = signStringToSign(key, xDate, scope, canonicalRequest)
  const authorization =
    `HMAC-SHA256 Credential=${cfg.ak}/${scope}, ` +
    `SignedHeaders=host;x-date, Signature=${signature}`
  return {
    url: `https://${cfg.host}/?${canonicalQuery}`,
    headers: {
      accept: 'application/json',
      'x-date': xDate,
      authorization
    }
  }
}

/** 一次 ListBillDetail 请求的公共参数(offset 由分页循环填)。
 * 实测(2026-09 探针):GroupPeriod 必须搭配 GroupTerm,取 2=按产品分组,
 * 行含 ExpenseDate/Currency/PayableAmount/Product,GroupPeriod=1 缺 GroupTerm 报 MissingParameter */
export function buildBillQuery(month: string, offset: number): Record<string, string> {
  return {
    Action: ACTION,
    Version: API_VERSION,
    BillPeriod: month,
    GroupTerm: '2',
    GroupPeriod: '1',
    Limit: String(PAGE_LIMIT),
    Offset: String(offset),
    NeedRecordNum: '1',
    IgnoreZero: '1'
  }
}

interface BillRawRow {
  ExpenseDate?: unknown
  PayableAmount?: unknown
  Currency?: unknown
  Product?: unknown
}

/** 计费中心应答解析:List 行 → (day, currency) 聚合金额 + 总行数(分页用) */
export function parseBillRows(json: unknown): { days: BillRowInput[]; total: number } {
  const body = (json ?? {}) as VolcEnvelope
  const result = body.Result as { List?: unknown; Total?: unknown } | undefined
  const list = result && Array.isArray(result.List) ? (result.List as BillRawRow[]) : null
  if (!list) {
    console.error(`[debug] ListBillDetail 结构变化: shape=${JSON.stringify(shapeOf(json))}`)
    throw ApiError('响应中无 Result.List,计费中心接口结构可能已变化')
  }
  const byDayCurrency = new Map<string, BillRowInput>()
  for (const row of list) {
    const day = trim(row?.ExpenseDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      console.error(`[debug] ListBillDetail 行缺 ExpenseDate: shape=${JSON.stringify(shapeOf(row))}`)
      throw ApiError('账单行缺少日期字段(ExpenseDate),按天聚合无法进行')
    }
    const amount = parseBalance(row?.PayableAmount)
    if (!Number.isFinite(amount)) {
      console.error(`[debug] ListBillDetail 行缺 PayableAmount: shape=${JSON.stringify(shapeOf(row))}`)
      throw ApiError('账单行缺少金额字段(PayableAmount),按天聚合无法进行')
    }
    const currency = trim(row?.Currency) || 'CNY'
    const key = `${day}|${currency}`
    const cur = byDayCurrency.get(key)
    if (cur) cur.amount = Number((cur.amount + amount).toFixed(10))
    else byDayCurrency.set(key, { day, currency, amount: Number(amount.toFixed(10)) })
  }
  const total = parseBalance(result?.Total)
  return { days: [...byDayCurrency.values()], total: Number.isFinite(total) ? total : list.length }
}

/** 信封级检查:HTTP 状态/ResponseMetadata.Error → ProviderError;通过则返回 Result */
function checkEnvelope(json: unknown, status: number, jsonOk: boolean): void {
  if (status === 401 || status === 403) {
    throw AuthError('访问密钥无效或无计费中心账单查询权限(子账号需 BillingCenterBillReadOnlyAccess)')
  }
  const body = (json ?? {}) as VolcEnvelope
  const err = body.ResponseMetadata?.Error
  if (err && typeof err === 'object') {
    const code = trim(err.Code) || 'Unknown'
    const msg = trim(err.Message) || code
    if (classifyError(code) === 'auth') {
      throw AuthError(`计费中心拒绝访问(${code}),请检查 AK/SK 或账单查询权限`)
    }
    throw ApiError(`计费中心接口错误: ${code} ${msg}`)
  }
  if (status >= 400 || !jsonOk) {
    console.error(`[debug] ListBillDetail 异常: HTTP ${status} shape=${JSON.stringify(shapeOf(json))}`)
    throw ApiError(`查询账单失败: HTTP ${status},请确认接口地址(官方为 ${HOST})`)
  }
}

export interface VolcBillMonthArgs {
  ak: string
  sk: string
  /** 账期 YYYY-MM */
  month: string
  host?: string
  throttleMs?: number
}

/**
 * 拉取单个账期的按天账单(内部完成分页),返回 (day, currency) 聚合后的金额。
 * 该月无消费时返回空数组。
 */
export async function fetchVolcBillMonth(args: VolcBillMonthArgs): Promise<BillRowInput[]> {
  const host = trim(args.host) || HOST
  const throttleMs = args.throttleMs ?? THROTTLE_MS
  const raw: BillRowInput[] = []
  let total = Number.POSITIVE_INFINITY
  let offset = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const signed = signVolcQueryRequest({
      params: buildBillQuery(args.month, offset),
      ak: args.ak,
      sk: args.sk,
      region: REGION,
      service: SERVICE,
      host,
      now: new Date()
    })
    const res = await requestJson(signed.url, { method: 'GET', headers: signed.headers })
    checkEnvelope(res.json, res.status, res.jsonOk)
    const parsed = parseBillRows(res.json)
    raw.push(...parsed.days)
    total = parsed.total
    offset += PAGE_LIMIT
    if (parsed.days.length === 0 || raw.length >= total || parsed.days.length < PAGE_LIMIT) break
    if (page < MAX_PAGES - 1) await sleep(throttleMs)
  }
  // parseBillRows 已按 (day,currency) 聚合单页;跨页同键可能再现,这里再聚一次
  const merged = new Map<string, BillRowInput>()
  for (const r of raw) {
    const key = `${r.day}|${r.currency}`
    const cur = merged.get(key)
    if (cur) cur.amount = Number((cur.amount + r.amount).toFixed(10))
    else merged.set(key, { ...r })
  }
  return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * 计算需要拉取的账期(旧→新):近 windowMonths 个自然月(含本月);
 * 已同步过的历史月跳过,但本月/上月始终重拉——账单次月 2 日才出全,
 * 且本月消费持续累加。纯函数,便于测试。
 */
export function monthsToFetch(now: Date, synced: Set<string>, windowMonths: number): string[] {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const current = fmt(now)
  const prev = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const out: string[] = []
  for (let i = windowMonths - 1; i >= 0; i--) {
    const month = fmt(new Date(now.getFullYear(), now.getMonth() - i, 1))
    if (synced.has(month) && month !== current && month !== prev) continue
    out.push(month)
  }
  return out
}
