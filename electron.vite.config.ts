import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const sharedAlias = {
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias
    },
    build: {
      // 防抖合并快速连续编辑:避免背靠背重建竞态把 out/main 写空(electron-vite watcher 偶发问题)
      watch: { buildDelay: 400 }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias
    },
    build: {
      watch: { buildDelay: 400 },
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          error: resolve('src/preload/error.ts')
        },
        output: {
          entryFileNames: '[name].js',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [vue()],
    // 显式绑定 IPv4，避免 Electron(Chromium) 与 Node 对 localhost 解析不一致导致连接被拒
    server: {
      host: '127.0.0.1'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    build: {
      rollupOptions: {
        // 多 HTML 入口:settings.html=设置窗口,float.html=悬浮窗,translate.html=译文弹窗
        input: {
          settings: resolve('src/renderer/settings.html'),
          float: resolve('src/renderer/float.html'),
          whale: resolve('src/renderer/whale.html'),
          balance: resolve('src/renderer/balance.html'),
          translate: resolve('src/renderer/translate.html')
        }
      }
    }
  }
})
