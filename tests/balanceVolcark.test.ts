/**
 * 火山方舟 Coding Plan 适配器测试。
 * 协议无官方测试向量,签名用"独立对照重推"(按火山 SigV4 规范在测试里重新推导一遍)
 * 与"同输入确定/SK 不同则变"(反例)双重校验;响应用 fetch 桩覆盖各形态。
 * 全程不接触真实凭据与真实配置。
 */
import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseVolcUsage, signVolcRequest, volcarkProvider } from '../src/main/balance/providers/volcark'
import { describeNewSite, describeTypes, getAdapter } from '../src/main/balance/providers'
import type { BalanceSite } from '../src/shared/balance'

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

function site(over: Partial<BalanceSite>): BalanceSite {
  return {
    id: 'v',
    type: 'volcark',
    label: '火山方舟',
    icon: 'bytedance',
    apiBaseUrl: 'https://open.volcengineapi.com',
    usageUrl: '',
    accessToken: 'AKTEST',
    refreshToken: 'SKTEST',
    enabled: true,
    ...over
  }
}

const noop = (): void => {}

interface Captured {
  url: string
  init: { method?: string; headers?: Record<string, string>; body?: unknown }
}

function stubFetchOk(body: unknown, captured: Captured[], status = 200): void {
  vi.stubGlobal('fetch', async (url: string, init: Captured['init'] = {}) => {
    captured.push({ url, init })
    return { status, json: async () => body }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('signVolcRequest:火山 SigV4 签名', () => {
  const FIXED = new Date('2026-09-21T02:03:04Z')

  /** 独立对照:按火山 SigV4 规范从零重推签名,不调用被测代码的派生链 */
  function controlSignature(ak: string, sk: string, xDate: string, host: string): string {
    const dateStamp = xDate.slice(0, 8)
    const canonical = [
      'POST',
      '/',
      'Action=GetCodingPlanUsage&Version=2024-01-01',
      'content-type:application/x-www-form-urlencoded; charset=utf-8',
      `host:${host}`,
      `x-content-sha256:${EMPTY_SHA256}`,
      `x-date:${xDate}`,
      '',
      'content-type;host;x-content-sha256;x-date',
      EMPTY_SHA256
    ].join('\n')
    const scope = `${dateStamp}/cn-beijing/ark/request`
    const sts = [
      'HMAC-SHA256',
      xDate,
      scope,
      createHash('sha256').update(canonical).digest('hex')
    ].join('\n')
    let key = createHmac('sha256', sk).update(dateStamp).digest()
    key = createHmac('sha256', key).update('cn-beijing').digest()
    key = createHmac('sha256', key).update('ark').digest()
    key = createHmac('sha256', key).update('request').digest()
    return `${createHmac('sha256', key).update(sts).digest('hex')}|${scope}|${ak}`
  }

  it('请求形态与签名派生链符合规范(独立对照)', () => {
    const out = signVolcRequest({
      action: 'GetCodingPlanUsage',
      version: '2024-01-01',
      ak: 'AKTEST',
      sk: 'SKTEST',
      region: 'cn-beijing',
      service: 'ark',
      host: 'open.volcengineapi.com',
      now: FIXED
    })
    expect(out.url).toBe('https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01')
    expect(out.headers['x-date']).toBe('20260921T020304Z')
    expect(out.headers['x-content-sha256']).toBe(EMPTY_SHA256)
    expect(out.headers['content-type']).toBe('application/x-www-form-urlencoded; charset=utf-8')
    const auth = out.headers.authorization
    expect(auth).toMatch(/^HMAC-SHA256 Credential=AKTEST\/\d{8}\/cn-beijing\/ark\/request, /)
    expect(auth).toContain('SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=')
    const signature = auth.split('Signature=')[1]
    // 独立重推:签名 + scope 逐位一致
    const expected = controlSignature('AKTEST', 'SKTEST', '20260921T020304Z', 'open.volcengineapi.com')
    expect(signature).toBe(expected.split('|')[0])
    expect(auth).toContain(`Credential=AKTEST/${expected.split('|')[1]}`)
  })

  it('边界:同输入签名确定;SK 变则签名变(反例)', () => {
    const base = { action: 'GetCodingPlanUsage', version: '2024-01-01', ak: 'AK', region: 'cn-beijing', service: 'ark', host: 'open.volcengineapi.com', now: FIXED }
    const a = signVolcRequest({ ...base, sk: 'SK-A' })
    const a2 = signVolcRequest({ ...base, sk: 'SK-A' })
    const b = signVolcRequest({ ...base, sk: 'SK-B' })
    expect(a.headers.authorization).toBe(a2.headers.authorization)
    expect(a.headers.authorization).not.toBe(b.headers.authorization)
  })
})

describe('parseVolcUsage:QuotaUsage 解析', () => {
  const RESULT = {
    ResponseMetadata: { RequestId: 'r1' },
    Result: {
      Status: 'normal',
      QuotaUsage: [
        { Level: 'weekly', Percent: 10, ResetTimestamp: 1758100000 },
        { Level: 'session', Percent: 35.4, ResetTimestamp: 1758000000 }
      ]
    }
  }

  it('取 session 窗口(五小时),ResetTimestamp 秒转 ISO', () => {
    const out = parseVolcUsage(RESULT)
    expect(out.percent).toBe(35.4)
    expect(out.resetIso).toBe(new Date(1758000000 * 1000).toISOString())
  })

  it('无 session 窗口时退回第一条', () => {
    const out = parseVolcUsage({
      Result: { QuotaUsage: [{ Level: 'weekly', Percent: 12.6 }] }
    })
    expect(out.percent).toBe(12.6)
  })

  it('边界:Percent 为数字字符串;ResetTimestamp 缺失/0 → 无重置时间', () => {
    expect(parseVolcUsage({ Result: { QuotaUsage: [{ Level: 'session', Percent: '35' }] } })).toEqual({
      percent: 35,
      resetIso: null
    })
    expect(
      parseVolcUsage({ Result: { QuotaUsage: [{ Level: 'session', Percent: 1, ResetTimestamp: 0 }] } })
    ).toEqual({ percent: 1, resetIso: null })
  })

  it('失败:Percent 缺失 → api(结构变化)', () => {
    expect(() => parseVolcUsage({ Result: { QuotaUsage: [{ Level: 'session' }] } })).toThrowError(
      expect.objectContaining({ kind: 'api' })
    )
  })

  it('失败:QuotaUsage 缺失/为空 → api', () => {
    expect(() => parseVolcUsage({ Result: {} })).toThrowError(
      expect.objectContaining({ kind: 'api' })
    )
    expect(() => parseVolcUsage({ Result: { QuotaUsage: [] } })).toThrowError(
      expect.objectContaining({ kind: 'api' })
    )
  })
})

describe('volcarkProvider.getBalance', () => {
  const OK_BODY = {
    ResponseMetadata: { RequestId: 'r1' },
    Result: { QuotaUsage: [{ Level: 'session', Percent: 35.4, ResetTimestamp: 1758000000 }] }
  }

  it('成功:POST 到正确 URL,凭据进签名不进 URL,currency=PCT 且 note=重置时间', async () => {
    const captured: Captured[] = []
    stubFetchOk(OK_BODY, captured)
    const out = await volcarkProvider.getBalance({ site: site({}), onTokensRefreshed: noop })
    expect(out).toEqual({
      balance: 35.4,
      currency: 'PCT',
      note: new Date(1758000000 * 1000).toISOString()
    })
    expect(captured).toHaveLength(1)
    const { url, init } = captured[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined() // 空请求体,与 x-content-sha256(空串) 一致
    expect(url).toBe('https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01')
    expect(url).not.toContain('SKTEST')
    const headers = init.headers || {}
    expect(headers.authorization).toContain('Credential=AKTEST/')
    expect(headers['x-date']).toMatch(/^\d{8}T\d{6}Z$/)
  })

  it('错误信封:SignatureDoesNotMatch → auth;InternalError → api', async () => {
    const captured: Captured[] = []
    stubFetchOk(
      { ResponseMetadata: { Error: { Code: 'SignatureDoesNotMatch', Message: 'bad sig' } } },
      captured
    )
    await expect(
      volcarkProvider.getBalance({ site: site({}), onTokensRefreshed: noop })
    ).rejects.toMatchObject({ kind: 'auth' })

    stubFetchOk({ ResponseMetadata: { Error: { Code: 'InternalError', Message: 'oops' } } }, captured)
    await expect(
      volcarkProvider.getBalance({ site: site({}), onTokensRefreshed: noop })
    ).rejects.toMatchObject({ kind: 'api' })
  })

  it('HTTP 401/403 → auth', async () => {
    const captured: Captured[] = []
    stubFetchOk({ Message: 'forbidden' }, captured, 403)
    await expect(
      volcarkProvider.getBalance({ site: site({}), onTokensRefreshed: noop })
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('边界:缺 SK 或非 http 地址 → setup', async () => {
    const captured: Captured[] = []
    stubFetchOk(OK_BODY, captured)
    await expect(
      volcarkProvider.getBalance({ site: site({ refreshToken: '' }), onTokensRefreshed: noop })
    ).rejects.toMatchObject({ kind: 'setup' })
    await expect(
      volcarkProvider.getBalance({
        site: site({ apiBaseUrl: 'open.volcengineapi.com' }),
        onTokensRefreshed: noop
      })
    ).rejects.toMatchObject({ kind: 'setup' })
    expect(captured).toHaveLength(0)
  })

  it('自定义 API 地址时签名 host 跟随(便于代理调试)', async () => {
    const captured: Captured[] = []
    stubFetchOk(OK_BODY, captured)
    await volcarkProvider.getBalance({
      site: site({ apiBaseUrl: 'https://ark.example.test' }),
      onTokensRefreshed: noop
    })
    expect(captured[0].url).toBe('https://ark.example.test/?Action=GetCodingPlanUsage&Version=2024-01-01')
  })
})

describe('注册表:volcark 类型', () => {
  it('已注册且默认值/引导字段齐全(不含凭据)', () => {
    expect(getAdapter('volcark')).not.toBeNull()
    const d = describeNewSite('volcark')
    expect(d).toMatchObject({
      type: 'volcark',
      label: '火山方舟',
      icon: 'bytedance',
      apiBaseUrl: 'https://open.volcengineapi.com',
      usageUrl: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan'
    })
    expect(d.tokenFields.map((f) => f.key)).toEqual(['accessToken', 'refreshToken'])
    expect(d.setupSteps.join('\n')).toContain('IAM')
    expect(JSON.stringify(d)).not.toContain('SKTEST')
  })

  it('describeTypes 含 volcark', () => {
    expect(describeTypes().some((t) => t.id === 'volcark')).toBe(true)
  })
})
