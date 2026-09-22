/**
 * 火山计费中心账单取数(volcbill)测试。
 *
 * 重点验证:
 * - GET 查询串版 SigV4:测试内按官方规范从零独立重推导签名并比对(与实现零共享代码),
 *   查询串字典序排序、SK 变则签名变、同输入确定性
 * - 请求参数:GroupTerm=2 + GroupPeriod=1(实测 GroupPeriod 必须搭配 GroupTerm)
 * - 行解析:(day,currency) 聚合、字符串金额、缺字段抛 ApiError
 * - 错误分类:签名/权限类 → auth,服务端类 → api,网络不通 → network
 * - monthsToFetch:24 个月窗口、已同步历史月跳过、本月/上月始终重拉、跨年边界
 * 全程 fetch 桩,不接触真实凭据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import {
  buildBillQuery,
  fetchVolcBillMonth,
  monthsToFetch,
  parseBillRows,
  signVolcQueryRequest
} from '../src/main/balance/providers/volcbill'
import { ProviderError } from '../src/main/balance/providers/base'

const NOW = new Date(2026, 8, 21, 12, 0, 0) // 2026-09-21 12:00 本地
const AK = 'AKTest1122334455'
const SK = 'SKTestsecretsecretsecretsecretsecret'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('signVolcQueryRequest:GET 查询串版签名(独立重推导对照)', () => {
  /** 测试内从零按规范推导一遍签名,与实现零共享代码 */
  function expectedSignature(params: Record<string, string>, now: Date, sk: string): string {
    const p = (n: number) => String(n).padStart(2, '0')
    const xDate =
      `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
      `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
    const dateStamp = xDate.slice(0, 8)
    const enc = (s: string) =>
      encodeURIComponent(s).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      )
    const canonicalQuery = Object.entries(params)
      .map(([k, v]) => `${enc(k)}=${enc(v)}`)
      .sort()
      .join('&')
    const emptySha = createHash('sha256').update('').digest('hex')
    const canonicalRequest = [
      'GET',
      '/',
      canonicalQuery,
      'host:billing.volcengineapi.com',
      `x-date:${xDate}`,
      '',
      'host;x-date',
      emptySha
    ].join('\n')
    const scope = `${dateStamp}/cn-beijing/billing/request`
    const stringToSign = [
      'HMAC-SHA256',
      xDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n')
    let key = createHmac('sha256', sk).update(dateStamp).digest()
    for (const part of ['cn-beijing', 'billing', 'request']) {
      key = createHmac('sha256', key).update(part).digest()
    }
    return createHmac('sha256', key).update(stringToSign).digest('hex')
  }

  it('对照:签名与规范重推导一致,URL 为排序编码后的查询串', () => {
    const params = buildBillQuery('2026-08', 0)
    const signed = signVolcQueryRequest({
      params,
      ak: AK,
      sk: SK,
      region: 'cn-beijing',
      service: 'billing',
      host: 'billing.volcengineapi.com',
      now: NOW
    })
    const sig = expectedSignature(params, NOW, SK)
    expect(signed.headers.authorization).toContain(`Credential=${AK}/`)
    expect(signed.headers.authorization).toContain('SignedHeaders=host;x-date')
    expect(signed.headers.authorization).toMatch(new RegExp(`Signature=${sig}$`))
    expect(signed.url).toMatch(/^https:\/\/billing\.volcengineapi\.com\/\?/)
    const url = new URL(signed.url)
    expect(url.searchParams.get('Action')).toBe('ListBillDetail')
    expect(url.searchParams.get('BillPeriod')).toBe('2026-08')
    // 查询串必须按 key 字典序排列(Action < BillPeriod < GroupPeriod < GroupTerm < …)
    const keys = [...url.searchParams.keys()]
    expect(keys).toEqual([...keys].sort())
    expect(signed.headers['x-date']).toBeTruthy()
  })

  it('确定性:同输入同签名;SK 变则签名变(反例)', () => {
    const params = buildBillQuery('2026-08', 0)
    const cfg = {
      params,
      ak: AK,
      sk: SK,
      region: 'cn-beijing',
      service: 'billing',
      host: 'billing.volcengineapi.com',
      now: NOW
    }
    const a = signVolcQueryRequest(cfg)
    const b = signVolcQueryRequest(cfg)
    expect(a.headers.authorization).toBe(b.headers.authorization)
    const other = signVolcQueryRequest({ ...cfg, sk: 'SK-other' })
    expect(other.headers.authorization).not.toBe(a.headers.authorization)
  })

  it('参数表:GroupTerm=2 与 GroupPeriod=1 必须同时在(实测缺 GroupTerm 报 MissingParameter)', () => {
    const q = buildBillQuery('2026-09', 0)
    expect(q).toMatchObject({
      Action: 'ListBillDetail',
      Version: '2022-01-01',
      GroupTerm: '2',
      GroupPeriod: '1',
      Limit: '300',
      Offset: '0',
      NeedRecordNum: '1',
      IgnoreZero: '1'
    })
  })
})

describe('parseBillRows:行解析与 (day,currency) 聚合', () => {
  it('对照:同日多产品行金额相加;字符串金额;币种缺省 CNY;Total 透传', () => {
    const { days, total } = parseBillRows({
      ResponseMetadata: {},
      Result: {
        Total: 3,
        List: [
          { ExpenseDate: '2026-08-26', PayableAmount: '5.00', Currency: 'CNY', Product: 'ark_bd' },
          { ExpenseDate: '2026-08-26', PayableAmount: '4.90', Currency: 'CNY', Product: 'cdn' },
          { ExpenseDate: '2026-08-27', PayableAmount: '1.10', Product: 'ark_bd' }
        ]
      }
    })
    expect(total).toBe(3)
    expect(days.sort((a, b) => a.day.localeCompare(b.day))).toEqual([
      { day: '2026-08-26', currency: 'CNY', amount: 9.9 },
      { day: '2026-08-27', currency: 'CNY', amount: 1.1 }
    ])
  })

  it('边界:负金额(退款)保留;空 List 合法(该月无消费)', () => {
    const refund = parseBillRows({
      ResponseMetadata: {},
      Result: { Total: 1, List: [{ ExpenseDate: '2026-08-01', PayableAmount: '-2', Currency: 'CNY' }] }
    })
    expect(refund.days).toEqual([{ day: '2026-08-01', currency: 'CNY', amount: -2 }])
    const empty = parseBillRows({ ResponseMetadata: {}, Result: { Total: 0, List: [] } })
    expect(empty.days).toEqual([])
    expect(empty.total).toBe(0)
  })

  it('反例:缺 Result.List / 缺 ExpenseDate / 缺 PayableAmount → ApiError', () => {
    const expectApi = (fn: () => unknown): void => {
      try {
        fn()
        expect.unreachable('should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        expect((e as ProviderError).kind).toBe('api')
      }
    }
    expectApi(() => parseBillRows({ ResponseMetadata: {} }))
    expectApi(() =>
      parseBillRows({ ResponseMetadata: {}, Result: { Total: 1, List: [{ PayableAmount: '1' }] } })
    )
    expectApi(() =>
      parseBillRows({ ResponseMetadata: {}, Result: { Total: 1, List: [{ ExpenseDate: '2026-08-01' }] } })
    )
  })
})

describe('fetchVolcBillMonth:请求与错误分类', () => {
  function stubBilling(responses: Array<{ status: number; body: unknown }>): void {
    let i = 0
    vi.stubGlobal('fetch', async () => {
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return { status: r.status, json: async () => r.body }
    })
  }

  it('成功:单页取完,返回按日聚合的账单', async () => {
    stubBilling([
      {
        status: 200,
        body: {
          ResponseMetadata: {},
          Result: {
            Total: 1,
            List: [{ ExpenseDate: '2026-08-26', PayableAmount: '9.90', Currency: 'CNY', Product: 'ark_bd' }]
          }
        }
      }
    ])
    const days = await fetchVolcBillMonth({ ak: AK, sk: SK, month: '2026-08', throttleMs: 0 })
    expect(days).toEqual([{ day: '2026-08-26', currency: 'CNY', amount: 9.9 }])
  })

  it('该月无消费:空数组不报错', async () => {
    stubBilling([{ status: 200, body: { ResponseMetadata: {}, Result: { Total: 0, List: [] } } }])
    expect(await fetchVolcBillMonth({ ak: AK, sk: SK, month: '2026-07', throttleMs: 0 })).toEqual([])
  })

  it('签名不匹配 → auth;权限类错误码 → auth;服务端错误 → api', async () => {
    stubBilling([
      {
        status: 400,
        body: {
          ResponseMetadata: {
            Error: { Code: 'SignatureDoesNotMatch', Message: 'check your Secret Access Key' }
          }
        }
      }
    ])
    await expect(fetchVolcBillMonth({ ak: AK, sk: SK, month: '2026-08', throttleMs: 0 })).rejects.toMatchObject({
      kind: 'auth'
    })

    stubBilling([
      {
        status: 403,
        body: {
          ResponseMetadata: {
            Error: { Code: 'AccessDenied', Message: 'not authorized for billing center' }
          }
        }
      }
    ])
    await expect(fetchVolcBillMonth({ ak: AK, sk: SK, month: '2026-08', throttleMs: 0 })).rejects.toMatchObject({
      kind: 'auth'
    })

    stubBilling([
      {
        status: 200,
        body: { ResponseMetadata: { Error: { Code: 'InternalError', Message: 'oops' } } }
      }
    ])
    await expect(fetchVolcBillMonth({ ak: AK, sk: SK, month: '2026-08', throttleMs: 0 })).rejects.toMatchObject({
      kind: 'api'
    })
  })

  it('网络不通 → network(下个周期重试即可)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(fetchVolcBillMonth({ ak: AK, sk: SK, month: '2026-08', throttleMs: 0 })).rejects.toMatchObject({
      kind: 'network'
    })
  })
})

describe('monthsToFetch:同步窗口(纯函数)', () => {
  it('对照:近 24 个自然月升序;已同步历史月跳过;本月/上月始终保留', () => {
    const now = new Date(2026, 8, 21) // 2026-09
    const all24 = monthsToFetch(now, new Set(), 24)
    expect(all24.length).toBe(24)
    expect(all24[0]).toBe('2024-10')
    expect(all24[23]).toBe('2026-09')
    expect(all24).toEqual([...all24].sort()) // 升序

    const synced = new Set(all24.slice(0, 23)) // 除本月外全部同步过
    expect(monthsToFetch(now, synced, 24)).toEqual(['2026-08', '2026-09'])

    const syncedAll = new Set(all24)
    expect(monthsToFetch(now, syncedAll, 24)).toEqual(['2026-08', '2026-09'])
  })

  it('跨年边界:now=2026-01 时窗口起点是 2024-02', () => {
    const now = new Date(2026, 0, 15)
    const all24 = monthsToFetch(now, new Set(), 24)
    expect(all24[0]).toBe('2024-02')
    expect(all24).toContain('2025-12')
    expect(all24[23]).toBe('2026-01')
  })
})
