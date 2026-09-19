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
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias
    },
    build: {
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
        // 多 HTML 入口:index.html=桌面版,float.html=悬浮窗,translate.html=译文弹窗
        input: {
          index: resolve('src/renderer/index.html'),
          float: resolve('src/renderer/float.html'),
          translate: resolve('src/renderer/translate.html')
        }
      }
    }
  }
})
