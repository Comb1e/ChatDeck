// electron-builder afterPack 钩子:打包后、压缩归档前裁剪非必需运行时文件,
// portable 与 NSIS 安装包同步受益。
const path = require('node:path')
const fs = require('node:fs')

// 语言包只保留 en-US/zh-CN(界面为中文,缺失语言回退英文;页面内容渲染无关)。
const KEEP = new Set(['en-US.pak', 'zh-CN.pak'])

// 删除 SwiftShader/Vulkan 软件渲染兜底:正常 GPU 机器走 ANGLE D3D11(d3dcompiler_47.dll 必须保留),
// 三个文件仅服务 GPU 异常恢复/无 Vulkan 驱动的 WebGPU/RDP 虚拟机场景,已确认放弃该兜底。
const DROP_RUNTIME = ['vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll']

module.exports.default = async function afterPack(context) {
  const outDir = context.appOutDir

  const localesDir = path.join(outDir, 'locales')
  if (fs.existsSync(localesDir)) {
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

  let runtimeFreed = 0
  for (const name of DROP_RUNTIME) {
    const file = path.join(outDir, name)
    if (!fs.existsSync(file)) continue
    runtimeFreed += fs.statSync(file).size
    fs.rmSync(file)
  }
  if (runtimeFreed > 0) {
    console.log(
      `[afterPack] swiftshader/vulkan fallback dropped: ${DROP_RUNTIME.join(', ')}, freed ${(runtimeFreed / 1048576).toFixed(1)} MB`
    )
  }
}
