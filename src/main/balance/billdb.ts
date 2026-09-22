/**
 * 本地账单库——账单明细窗口的统一数据面(SQLite,经 sql.js 的 WASM 构建,零原生依赖)。
 *
 * 为什么选 sql.js 而不是 better-sqlite3:本项目 dependencies 一向为空、打包只含 out/*
 * 编译产物,原生模块要过 MSVC 编译/GitHub 拉 prebuild 两道关;sql.js 是纯 WASM,直接从
 * node_modules 加载(打包后 electron-builder 带上生产依赖,asar 内读 wasm 正常),落盘的
 * 仍是标准 SQLite 文件,可用任意工具打开。
 *
 * 表:
 * - bill_day:每站点 × 每日 × 每币种一行(amount 允许为负,如退款)。来源三口径:
 *   api(站点记账,如 sub2api 趋势)、metered(本机按余额下降计量)、volcbill(计费中心真实账单)。
 *   写入优先级:metered 不覆盖 api/volcbill(真实记账优先于本机估算),其余情况后写覆盖——
 *   用一条带 WHERE 的 upsert 表达,同一行不会被本机计量倒灌。
 * - bill_sync:每站点已完整同步过的账期(YYYY-MM),避免重复拉历史;本月/上月始终重拉
 *   (账单次月 2 日才出全),由调用方(volcbill 同步流程)决定窗口,本库只存取。
 *
 * 持久化:sql.js 是内存库,变更后防抖导出字节流原子写盘;路径由组合根注入,传 null
 * 则纯内存(测试用),与 UsageStore 的注入方式一致。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'

/** 账单来源口径(与 BalanceUsedSource 对齐,这里收紧为入库允许的三种) */
export type BillSource = 'api' | 'metered' | 'volcbill'

/** 一条待入库的日账单(单站点单日单币种) */
export interface BillRowInput {
  /** YYYY-MM-DD */
  day: string
  currency: string
  /** 应付金额(允许负值,如退款) */
  amount: number
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/
/** 变更落盘防抖:账单窗口打开时一批写入,合并成一次文件写 */
const FLUSH_DELAY_MS = 1500

export class BillDb {
  private sql: SqlJsStatic | null = null
  private db: Database | null = null
  private initPromise: Promise<void> | null = null
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly filePath: string | null) {}

  /** 完成初始化(幂等);所有读写前必须 await */
  async ready(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.init()
    await this.initPromise
  }

  private async init(): Promise<void> {
    // 不传 locateFile:sql.js 在 Node 下按自身 __dirname 定位 sql-wasm.wasm,
    // dev 与打包(asar)都是 node_modules/sql.js/dist 内,无需区分环境
    this.sql = await initSqlJs()
    let data: Uint8Array | null = null
    if (this.filePath) {
      try {
        data = readFileSync(this.filePath)
      } catch {
        data = null // 首次运行从空库开始
      }
    }
    try {
      this.db = data ? new this.sql.Database(data) : new this.sql.Database()
      this.migrate()
    } catch {
      // 文件存在但不是合法 SQLite(sqlite3_open 可能惰性报错,建表同样纳入兜底):
      // 派生数据不值得让窗口挂掉,换空库重来
      this.db = new this.sql.Database()
      this.migrate()
    }
  }

  private migrate(): void {
    this.assertDb().run(`
      CREATE TABLE IF NOT EXISTS bill_day (
        site_id    TEXT NOT NULL,
        day        TEXT NOT NULL,
        currency   TEXT NOT NULL,
        amount     REAL NOT NULL,
        source     TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (site_id, day, currency)
      );
      CREATE INDEX IF NOT EXISTS idx_bill_day_site ON bill_day (site_id, day);
      CREATE TABLE IF NOT EXISTS bill_sync (
        site_id   TEXT NOT NULL,
        month     TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (site_id, month)
      );
    `)
  }

  private assertDb(): Database {
    if (!this.db) throw new Error('BillDb 尚未初始化(先 await ready())')
    return this.db
  }

  private touch(): void {
    if (!this.filePath) return
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushSync()
    }, FLUSH_DELAY_MS)
    this.flushTimer.unref()
  }

  /** 立即把内存库导出落盘(原子写);未初始化或纯内存模式为空操作 */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.filePath || !this.db) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, Buffer.from(this.db.export()))
    renameSync(tmp, this.filePath)
  }

  /**
   * 批量 upsert 一个站点的日账单。
   * 优先级用 SQL 表达:incoming 为 metered 时仅当现有行也是 metered(或不存在)才写,
   * api/volcbill 的既有行不被本机计量倒灌;incoming 为 api/volcbill 时后写覆盖。
   */
  upsertDays(siteId: string, rows: BillRowInput[], source: BillSource): void {
    if (!rows.length) return
    const db = this.assertDb()
    const now = Date.now()
    db.run('BEGIN TRANSACTION')
    try {
      const stmt = db.prepare(`
        INSERT INTO bill_day (site_id, day, currency, amount, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (site_id, day, currency) DO UPDATE SET
          amount = excluded.amount,
          source = excluded.source,
          updated_at = excluded.updated_at
        WHERE excluded.source != 'metered' OR bill_day.source = 'metered'
      `)
      for (const r of rows) {
        if (!DAY_RE.test(r.day)) continue
        const amount = Number(r.amount)
        if (!Number.isFinite(amount)) continue
        const currency = typeof r.currency === 'string' && r.currency.trim() ? r.currency.trim() : 'CNY'
        stmt.run([siteId, r.day, currency, Number(amount.toFixed(10)), source, now])
      }
      stmt.free()
      db.run('COMMIT')
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }
    this.touch()
  }

  /** 标记某站点某账期已完成同步 */
  markMonthSynced(siteId: string, month: string): void {
    if (!MONTH_RE.test(month)) return
    this.assertDb()
      .prepare('INSERT OR REPLACE INTO bill_sync (site_id, month, synced_at) VALUES (?, ?, ?)')
      .run([siteId, month, Date.now()])
    this.touch()
  }

  /** 某站点已同步过的账期集合 */
  syncedMonths(siteId: string): Set<string> {
    const rows = this.all<{ month: string }>(
      'SELECT month FROM bill_sync WHERE site_id = ?',
      [siteId]
    )
    return new Set(rows.map((r) => r.month))
  }

  /** 按日聚合(仅 [from, to] 闭区间,日期升序;跨币种求和——单站点实际单币种) */
  siteDays(siteId: string, from: string, to: string): { date: string; used: number }[] {
    const rows = this.all<{ day: string; used: number }>(
      `SELECT day, SUM(amount) AS used FROM bill_day
       WHERE site_id = ? AND day >= ? AND day <= ?
       GROUP BY day ORDER BY day`,
      [siteId, from, to]
    )
    return rows.map((r) => ({ date: r.day, used: r.used }))
  }

  /** 按月聚合(仅 [fromMonth, …] 起,月份升序) */
  siteMonths(siteId: string, fromMonth: string): { month: string; used: number }[] {
    const rows = this.all<{ month: string; used: number }>(
      `SELECT substr(day, 1, 7) AS month, SUM(amount) AS used FROM bill_day
       WHERE site_id = ? AND substr(day, 1, 7) >= ?
       GROUP BY month ORDER BY month`,
      [siteId, fromMonth]
    )
    return rows
  }

  /** 按年聚合(全部,年份升序) */
  siteYears(siteId: string): { year: string; used: number }[] {
    return this.all<{ year: string; used: number }>(
      `SELECT substr(day, 1, 4) AS year, SUM(amount) AS used FROM bill_day
       WHERE site_id = ? GROUP BY year ORDER BY year`,
      [siteId]
    )
  }

  /** 库内出现过的来源(用于报告选择口径徽章与回退文案) */
  siteSources(siteId: string): Set<BillSource> {
    const rows = this.all<{ source: BillSource }>(
      'SELECT DISTINCT source FROM bill_day WHERE site_id = ?',
      [siteId]
    )
    return new Set(rows.map((r) => r.source))
  }

  /** 某来源的累计金额(全时间) */
  siteTotalBySource(siteId: string, source: BillSource): number {
    const rows = this.all<{ total: number | null }>(
      'SELECT SUM(amount) AS total FROM bill_day WHERE site_id = ? AND source = ?',
      [siteId, source]
    )
    return rows[0]?.total ?? 0
  }

  /** 全部来源累计金额 */
  siteTotal(siteId: string): number {
    const rows = this.all<{ total: number | null }>(
      'SELECT SUM(amount) AS total FROM bill_day WHERE site_id = ?',
      [siteId]
    )
    return rows[0]?.total ?? 0
  }

  /** 最早账单日(可限定来源;无数据返回 null) */
  siteEarliestDay(siteId: string, source?: BillSource): string | null {
    const rows = source
      ? this.all<{ day: string }>(
          'SELECT MIN(day) AS day FROM bill_day WHERE site_id = ? AND source = ?',
          [siteId, source]
        )
      : this.all<{ day: string }>('SELECT MIN(day) AS day FROM bill_day WHERE site_id = ?', [
          siteId
        ])
    return rows[0]?.day ?? null
  }

  /**
   * 清掉 [fromDay, toDay] 区间内的本机计量行。api/volcbill 同步成功后对其覆盖区间
   * 是权威数据(未上报的日子就是 0),必须清掉同区间的 metered 行,否则两口径叠加重复计数。
   */
  clearMeteredRange(siteId: string, fromDay: string, toDay: string): void {
    this.assertDb()
      .prepare('DELETE FROM bill_day WHERE site_id = ? AND source = ? AND day >= ? AND day <= ?')
      .run([siteId, 'metered', fromDay, toDay])
    this.touch()
  }

  /** 占比最高的币种(报告的 currency 标签;无数据返回 null) */
  siteDominantCurrency(siteId: string): string | null {
    const rows = this.all<{ currency: string }>(
      `SELECT currency FROM bill_day WHERE site_id = ?
       GROUP BY currency ORDER BY SUM(amount) DESC LIMIT 1`,
      [siteId]
    )
    return rows[0]?.currency ?? null
  }

  /** 站点删除后清掉账单,避免孤儿数据(与 UsageStore.remove 对齐) */
  removeSite(siteId: string): void {
    const db = this.assertDb()
    db.prepare('DELETE FROM bill_day WHERE site_id = ?').run([siteId])
    db.prepare('DELETE FROM bill_sync WHERE site_id = ?').run([siteId])
    this.touch()
  }

  private all<T>(sql: string, params: (string | number)[]): T[] {
    const db = this.assertDb()
    const stmt = db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }
}
