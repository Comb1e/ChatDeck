/**
 * 站点适配器边界测试——移植自 token-balance scripts/test-provider-shapes.js 与
 * scripts/test-deepseek.js（原为独立 node 脚本 + fetch 桩，现改为 vitest）。
 * 用 fetch 桩独立控制响应，覆盖嵌套/平铺两种形态与各类异常，不接触真实配置与真实 API。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sub2apiProvider } from '../src/main/balance/providers/sub2api'
import { deepseekProvider } from '../src/main/balance/providers/deepseek'
import type { BalanceSite } from '../src/shared/balance'

interface StubResponse {
  status: number
  body: unknown
}

let queue: StubResponse[] = []

function stubFetch(responses: StubResponse | StubResponse[]): void {
  queue = Array.isArray(responses) ? responses.slice() : [responses]
  vi.stubGlobal('fetch', async () => {
    const r = queue.shift()
    if (!r) throw new Error('测试桩缺少应答')
    return { status: r.status, json: async () => r.body }
  })
}

function site(over: Partial<BalanceSite>): BalanceSite {
  return {
    id: 'test',
    type: 'sub2api',
    label: 'test',
    icon: 'openai',
    apiBaseUrl: '',
    usageUrl: '',
    accessToken: '',
    refreshToken: '',
    enabled: true,
    ...over
  }
}

const noop = (): void => {}

/** 断言适配器结果：成功比对余额，失败比对错误 kind */
async function expectSub2api(
  input: StubResponse | StubResponse[],
  expected: { kind: 'ok'; balance: number } | { kind: string }
): Promise<void> {
  stubFetch(input)
  try {
    const out = await sub2apiProvider.getBalance({
      site: site({ accessToken: 'a', refreshToken: 'r', apiBaseUrl: 'https://example.test/api/v1' }),
      onTokensRefreshed: noop
    })
    expect({ kind: 'ok', balance: out.balance }).toEqual(expected)
  } catch (e) {
    expect({ kind: (e as { kind: string }).kind }).toEqual(expected)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sub2api 适配器 /auth/me 响应结构', () => {
  it('站点实测形态：用户对象平铺在 data 下', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: { id: 1, balance: 4.97 } } },
      { kind: 'ok', balance: 4.97 }
    )
  })

  it('兼容嵌套 data.user 形态', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: { user: { balance: 12.5 } } } },
      { kind: 'ok', balance: 12.5 }
    )
  })

  it('边界:余额为 0 不能被当成"缺失"', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: { balance: 0 } } },
      { kind: 'ok', balance: 0 }
    )
  })

  it('边界:字符串余额 "4.97"', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: { balance: '4.97' } } },
      { kind: 'ok', balance: 4.97 }
    )
  })

  it('失败:code=500', async () => {
    await expectSub2api(
      { status: 200, body: { code: 500, message: '内部错误', data: null } },
      { kind: 'api' }
    )
  })

  it('失败:缺 balance 字段（结构变化告警路径）', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: { id: 1 } } },
      { kind: 'api' }
    )
  })

  it('失败:balance=null', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: { balance: null } } },
      { kind: 'api' }
    )
  })

  it('失败:data=null', async () => {
    await expectSub2api(
      { status: 200, body: { code: 0, message: 'success', data: null } },
      { kind: 'api' }
    )
  })

  it('失败:非 JSON 响应体', async () => {
    await expectSub2api({ status: 502, body: null }, { kind: 'api' })
  })

  it('鉴权:401 后 refresh 成功 → 用新 token 重试成功', async () => {
    await expectSub2api(
      [
        { status: 401, body: null },
        {
          status: 200,
          body: { code: 0, data: { access_token: 'new', refresh_token: 'new-r', expires_in: 3600 } }
        },
        { status: 200, body: { code: 0, message: 'success', data: { balance: 7.7 } } }
      ],
      { kind: 'ok', balance: 7.7 }
    )
  })

  it('鉴权:401 且 refresh 失败 → auth（需用户重新粘贴）', async () => {
    await expectSub2api(
      [
        { status: 401, body: null },
        { status: 401, body: { code: 401, message: 'refresh_token 无效' } }
      ],
      { kind: 'auth' }
    )
  })

  it('边界:未配置 token → setup', async () => {
    stubFetch({ status: 200, body: {} })
    await expect(
      sub2apiProvider.getBalance({
        site: site({ apiBaseUrl: 'https://example.test/api/v1' }),
        onTokensRefreshed: noop
      })
    ).rejects.toMatchObject({ kind: 'setup' })
  })

  it('边界:未配置 API 地址 → setup', async () => {
    stubFetch({ status: 200, body: {} })
    await expect(
      sub2apiProvider.getBalance({
        site: site({ accessToken: 'a', refreshToken: 'r' }),
        onTokensRefreshed: noop
      })
    ).rejects.toMatchObject({ kind: 'setup' })
  })

  it('续期成功时把轮换后的凭据回调出去', async () => {
    stubFetch([
      { status: 401, body: null },
      { status: 200, body: { code: 0, data: { access_token: 'A2', refresh_token: 'R2' } } },
      { status: 200, body: { code: 0, data: { balance: 1 } } }
    ])
    const refreshed: unknown[] = []
    await sub2apiProvider.getBalance({
      site: site({ accessToken: 'a', refreshToken: 'r', apiBaseUrl: 'https://example.test/api/v1' }),
      onTokensRefreshed: (t) => refreshed.push(t)
    })
    expect(refreshed).toEqual([{ accessToken: 'A2', refreshToken: 'R2' }])
  })
})

describe('DeepSeek 适配器 /user/balance', () => {
  const DS_BASE = 'https://api.deepseek.com'

  async function expectDeepseek(
    input: StubResponse | StubResponse[],
    expected: { kind: 'ok'; balance: number; currency: string } | { kind: string }
  ): Promise<void> {
    stubFetch(input)
    try {
      const out = await deepseekProvider.getBalance({
        site: site({ type: 'deepseek', accessToken: 'sk-test', apiBaseUrl: DS_BASE }),
        onTokensRefreshed: noop
      })
      expect({ kind: 'ok', balance: out.balance, currency: out.currency ?? 'USD' }).toEqual(expected)
    } catch (e) {
      expect({ kind: (e as { kind: string }).kind }).toEqual(expected)
    }
  }

  it('官方文档示例形态:CNY 字符串余额', async () => {
    await expectDeepseek(
      {
        status: 200,
        body: {
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '110.00',
              granted_balance: '0.00',
              topped_up_balance: '110.00'
            }
          ]
        }
      },
      { kind: 'ok', balance: 110, currency: 'CNY' }
    )
  })

  it('USD 数字余额', async () => {
    await expectDeepseek(
      {
        status: 200,
        body: { is_available: true, balance_infos: [{ currency: 'USD', total_balance: 5.5 }] }
      },
      { kind: 'ok', balance: 5.5, currency: 'USD' }
    )
  })

  it('边界:余额为 0 不能被当成"缺失"', async () => {
    await expectDeepseek(
      {
        status: 200,
        body: { is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0.00' }] }
      },
      { kind: 'ok', balance: 0, currency: 'CNY' }
    )
  })

  it('多条 balance_infos 取第一条', async () => {
    await expectDeepseek(
      {
        status: 200,
        body: {
          is_available: true,
          balance_infos: [
            { currency: 'CNY', total_balance: '88.50' },
            { currency: 'USD', total_balance: '2.00' }
          ]
        }
      },
      { kind: 'ok', balance: 88.5, currency: 'CNY' }
    )
  })

  it('边界:currency 缺失时回退 USD', async () => {
    await expectDeepseek(
      { status: 200, body: { is_available: true, balance_infos: [{ total_balance: '3.20' }] } },
      { kind: 'ok', balance: 3.2, currency: 'USD' }
    )
  })

  it('鉴权:401 → auth', async () => {
    await expectDeepseek(
      { status: 401, body: { error: { message: 'Authentication Fails' } } },
      { kind: 'auth' }
    )
  })

  it('鉴权:403 → auth', async () => {
    await expectDeepseek({ status: 403, body: null }, { kind: 'auth' })
  })

  it('失败:缺 balance_infos（地址填错时常见，如指向 /v1）', async () => {
    await expectDeepseek({ status: 200, body: { code: 0, data: null } }, { kind: 'api' })
  })

  it('失败:balance_infos 空数组', async () => {
    await expectDeepseek({ status: 200, body: { is_available: true, balance_infos: [] } }, { kind: 'api' })
  })

  it('失败:total_balance=null（结构变化告警路径）', async () => {
    await expectDeepseek(
      {
        status: 200,
        body: { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: null }] }
      },
      { kind: 'api' }
    )
  })

  it('失败:非 JSON 响应体', async () => {
    await expectDeepseek({ status: 502, body: null }, { kind: 'api' })
  })

  it('边界:未配置地址 → setup', async () => {
    stubFetch({ status: 200, body: {} })
    await expect(
      deepseekProvider.getBalance({
        site: site({ type: 'deepseek', accessToken: 'sk-test' }),
        onTokensRefreshed: noop
      })
    ).rejects.toMatchObject({ kind: 'setup' })
  })

  it('边界:未配置 Key → setup', async () => {
    stubFetch({ status: 200, body: {} })
    await expect(
      deepseekProvider.getBalance({
        site: site({ type: 'deepseek', apiBaseUrl: DS_BASE }),
        onTokensRefreshed: noop
      })
    ).rejects.toMatchObject({ kind: 'setup' })
  })
})
