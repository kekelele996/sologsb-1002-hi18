import assert from 'node:assert'
import React from 'react'
import { renderToString } from 'react-dom/server'
import App from '../src/App.tsx'

const storage = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
  setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  removeItem: (key: string) => { storage.delete(key) },
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
} as Storage
// antd 部分组件在 SSR 下会探测 matchMedia
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
}

const html = renderToString(React.createElement(App))
assert.ok(html.includes('学术论文协作审阅台'), '应用正常渲染')
assert.ok(html.includes('导出审阅包'), '导出按钮已渲染')
assert.ok(html.includes('导入审阅包'), '导入按钮已渲染')
console.log('SSR 冒烟通过：应用渲染、导入/导出入口均存在 ✔')
