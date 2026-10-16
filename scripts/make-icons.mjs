// public/favicon.svg 에서 PWA 아이콘 PNG를 만든다. 실행: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const inner = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '')
// 마스크 아이콘은 가장자리 20%가 잘릴 수 있어 그림을 72%로 줄여 가운데에 둔다
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#F4F1EC"/><g transform="translate(71.68 71.68) scale(0.72)">${inner.replace(/<rect[^>]*\/>/, '')}</g></svg>`

const targets = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon.png', 180, svg],
]
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, source] of targets) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0"><img src="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}" width="${size}" height="${size}"></body>`)
  writeFileSync(new URL(`../public/${file}`, import.meta.url), await page.screenshot({ type: 'png' }))
}
await browser.close()
