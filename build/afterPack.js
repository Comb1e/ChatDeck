// electron-builder afterPack 钩子:裁剪 Chromium 自带语言包。
// 只保留 en-US/zh-CN 两个 .pak(界面为中文,缺失语言回退英文;页面内容渲染无关),
// 时机在 7z/NSIS 压缩归档之前,portable 与 NSIS 安装包同步受益。
const path = require('node:path')
const fs = require('node:fs')

const KEEP = new Set(['en-US.pak', 'zh-CN.pak'])

module.exports.default = async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales')
  if (!fs.existsSync(localesDir)) return
  let freed = 0
  let removed = 0
  for (const name of fs.readdirSync(localesDir)) {
    if (KEEP.has(name)) continue
    const file = path.join(localesDir, name)
    freed += fs.statSync(file).size
    fs.rmSync(file)
    removed++
  }
  if (removed > 0) {
    console.log(
      `[afterPack] locales trimmed: kept ${[...KEEP].join(' + ')}, removed ${removed} paks, freed ${(freed / 1048576).toFixed(1)} MB`
    )
  }
}
