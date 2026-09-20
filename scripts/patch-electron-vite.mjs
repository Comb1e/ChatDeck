// 给 electron-vite 的 dev watcher 打补丁(幂等,npm postinstall 自动执行):
// 修复"偶发空重建把 out/main 写空 → 重启 electron 时抛 No electron app entry file found → dev 会话死亡"。
// 方案:主进程重建完成后、重启 electron 前,检查入口产物是否存在;缺失则跳过本次重启并告警,
// 当前 electron 进程继续用旧代码运行,下一次有效重建会正常重启 —— 自愈而非死亡。
// electron-vite 升级导致锚点失配时仅警告、不阻塞安装。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHUNKS = [
  'node_modules/electron-vite/dist/chunks/lib-PoOhNRXw.mjs', // ESM
  'node_modules/electron-vite/dist/chunks/lib-BGeLv6EJ.cjs' // CJS
]
const MARK = 'evEntryReady'
// 注意:chunk 源码里的 `\n` 是字面反斜杠+n(日志字符串),此处用 \\n 匹配
const ANCHOR = 'if (ps) {\n                    logger.info(colors.cyan(`\\n  waiting for electron to exit...`));'
const GUARD =
  'if (ps) {\n' +
  '                    if (!' +
  MARK +
  '()) {\n' +
  "                        logger.warn(colors.yellow(`\\n  skip electron restart: entry missing after rebuild (empty-rebuild guard), waiting for next rebuild`));\n" +
  '                        return;\n' +
  '                    }\n' +
  '                    logger.info(colors.cyan(`\\n  waiting for electron to exit...`));'
const CREATE_SERVER_ANCHOR = 'async function createServer('
const HELPER_ESM = `import { existsSync as evExistsSync, readFileSync as evReadFileSync } from 'node:fs';
import { resolve as evResolve } from 'node:path';
const ${MARK} = () => { try { const pkg = JSON.parse(evReadFileSync(evResolve(process.cwd(), 'package.json'), 'utf-8')); return !pkg.main || evExistsSync(evResolve(process.cwd(), pkg.main)); } catch { return true; } };
`
const HELPER_CJS = `const ${MARK} = (() => { const evFs = require('node:fs'); const evPath = require('node:path'); return () => { try { const pkg = JSON.parse(evFs.readFileSync(evPath.resolve(process.cwd(), 'package.json'), 'utf-8')); return !pkg.main || evFs.existsSync(evPath.resolve(process.cwd(), pkg.main)); } catch { return true; } }; })();
`

let patched = 0
for (const rel of CHUNKS) {
  const file = join(root, rel)
  if (!existsSync(file)) {
    console.warn(`[patch-electron-vite] skip (not found): ${rel}`)
    continue
  }
  let src = readFileSync(file, 'utf-8')
  if (src.includes(MARK)) {
    console.log(`[patch-electron-vite] already patched: ${rel}`)
    patched++
    continue
  }
  if (!src.includes(ANCHOR) || !src.includes(CREATE_SERVER_ANCHOR)) {
    console.warn(`[patch-electron-vite] anchor drift, skipped (electron-vite 可能已升级,请人工核对): ${rel}`)
    continue
  }
  const helper = rel.endsWith('.mjs') ? HELPER_ESM : HELPER_CJS
  src = src.replace(CREATE_SERVER_ANCHOR, helper + CREATE_SERVER_ANCHOR)
  src = src.replace(ANCHOR, GUARD)
  writeFileSync(file, src)
  console.log(`[patch-electron-vite] patched: ${rel}`)
  patched++
}
if (patched === 0) {
  console.warn('[patch-electron-vite] no chunk patched —— dev watcher 空重建守卫未生效')
}
