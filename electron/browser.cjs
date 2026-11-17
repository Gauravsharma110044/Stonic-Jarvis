// Jarvis browser agent — persistent Playwright Chromium session
const { chromium } = require('playwright')

let browser = null
let ctx = null
let page = null
let profileDir = null

async function ensure() {
  if (!browser || !browser.isConnected()) {
    const { app } = require('electron')
    const path = require('path')
    profileDir = path.join(app.getPath('userData'), 'jarvis-browser-profile')
    ctx = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1366, height: 850 },
      locale: 'en-US',
      args: ['--start-minimized'],
    })
    page = ctx.pages()[0] || await ctx.newPage()
    browser = ctx.browser()
  }
  if (page.isClosed()) page = await ctx.newPage()
  return page
}

const snapLimit = 12000
async function snapshot() {
  const p = await ensure()
  // accessibility-ish snapshot: interactive elements + visible text
  const data = await p.evaluate(() => {
    const els = [...document.querySelectorAll('a,button,input,textarea,select,[role=button],[onclick],h1,h2,h3')]
      .slice(0, 200)
      .map((el, i) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return null
        const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 80)
        return label ? `[${i}] <${el.tagName.toLowerCase()}> "${label}"` : null
      })
      .filter(Boolean)
    return { url: location.href, title: document.title, els, text: document.body.innerText.slice(0, 4000) }
  })
  return `URL: ${data.url}\nTitle: ${data.title}\n\nInteractive elements:\n${data.els.join('\n')}\n\nPage text:\n${data.text}`
}

async function act(fn) {
  const p = await ensure()
  try { return await fn(p) } catch (e) { return `Browser error: ${e.message}` }
}

module.exports = {
  ensure,
  snapshot,
  // tool implementations
  async navigate(url) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    return act(async p => {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await p.waitForTimeout(800)
      return `Opened ${url}`
    })
  },
  async click(text) {
    return act(async p => {
      const loc = p.getByText(text, { exact: false }).first()
      await loc.click({ timeout: 8000 })
      await p.waitForTimeout(800)
      return `Clicked "${text}"`
    })
  },
  async type(text, selector) {
    return act(async p => {
      const loc = selector ? p.locator(selector).first() : p.locator('input:visible, textarea:visible').first()
      await loc.click({ timeout: 5000 })
      await loc.fill(String(text).slice(0, 2000))
      return `Typed into ${selector || 'first input'}`
    })
  },
  async press(key) {
    return act(async p => { await p.keyboard.press(key); await p.waitForTimeout(500); return `Pressed ${key}` })
  },
  async scroll(dir) {
    return act(async p => {
      await p.mouse.wheel(0, dir === 'up' ? -800 : 800)
      await p.waitForTimeout(400)
      return `Scrolled ${dir}`
    })
  },
  async back() {
    return act(async p => { await p.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}); return 'Went back' })
  },
  async evaluate(js) {
    return act(async p => {
      const r = await p.evaluate(String(js).slice(0, 4000))
      return typeof r === 'string' ? r.slice(0, snapLimit) : JSON.stringify(r)?.slice(0, snapLimit)
    })
  },
  async screenshot() {
    return act(async p => {
      const { app } = require('electron')
      const fs = require('fs'), path = require('path')
      const f = path.join(app.getPath('temp'), `jarvis-browser-${Date.now()}.png`)
      await p.screenshot({ path: f, fullPage: false })
      return `Screenshot saved: ${f}`
    })
  },
  async close() {
    try { if (ctx) await ctx.close() } catch {}
    browser = ctx = page = null
    return 'Browser closed (session saved — logins persist).'
  },
}
