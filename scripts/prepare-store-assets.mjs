import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { chromium } from 'playwright'

const output = resolve('release/chrome-web-store-0.0.1/images')
await mkdir(output, { recursive: true })
const sourceIcon = await sharp('public/icons/foxmind.svg').resize(128, 128).png().toBuffer()
const icon = await sharp(sourceIcon).extract({ left: 4, top: 4, width: 120, height: 120 })
  .resize(96, 96).png().toBuffer()
await sharp(icon).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toFile(join(output, 'icon-128.png'))

const temporary = await mkdtemp(join(tmpdir(), 'foxmind-store-'))
const extension = join(temporary, 'extension')
await cp('dist', extension, { recursive: true })
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'))
manifest.host_permissions.push('https://example.test/*')
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
  executablePath: chromium.executablePath(), headless: true, colorScheme: 'light',
  viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
})
const articleUrl = 'https://example.test/research/urban-forest'
const content = {
  'zh-CN': {
    title: '城市里的树，如何让夏天更凉？',
    intro: '城市自然观察 · 阅读示例',
    overview: '树冠为街道遮挡阳光，也通过蒸腾作用帮助降温。增加树木覆盖，需要同时考虑树种、空间与日常养护。',
    points: ['树荫可以减少地面的直接日照，降低行人感受到的热量。', '持续记录温度、覆盖率与降水量，有助于比较不同街区的改善效果。'],
    paragraphs: ['树冠遮挡直射阳光，路面与墙体吸收的热量随之减少。在步行空间增加连续树荫，可以改善午后的户外体验。', '树木通过叶片蒸腾释放水分，参与局部水分循环。实际降温效果与气候、土壤含水量、树种和覆盖面积相关。', '团队建议持续记录街区的温度、树冠覆盖率与降水量，并结合后续养护安排进行观察。'],
    selection: '持续记录温度与覆盖率，能够帮助比较不同街区的改善效果。',
    demo: '演示文章',
  },
  en: {
    title: 'How trees help cool our cities',
    intro: 'Urban nature notes · Sample article',
    overview: 'Tree canopies shade streets and support cooling through transpiration. Planting plans also need space, suitable species and ongoing care.',
    points: ['Shade reduces direct sunlight on surfaces and improves the experience of walking on warm afternoons.', 'Recording temperature, canopy cover and rainfall helps compare changes across neighbourhoods.'],
    paragraphs: ['Tree canopies intercept direct sunlight, reducing heat absorbed by roads and walls. Continuous shade can make outdoor walking more comfortable during warm afternoons.', 'Leaves release moisture through transpiration. Local cooling depends on climate, soil moisture, species and the area covered by trees.', 'The team recommends recording neighbourhood temperatures, canopy cover and rainfall over time, alongside a realistic plan for tree care.'],
    selection: 'Recording temperature and canopy cover helps compare changes across neighbourhoods.',
    demo: 'Sample article',
  },
}
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const base = worker.url().replace(/\/background\.js$/, '')
  let current = content.en
  const articleHtml = () => '<!doctype html><html><head><meta charset="utf-8"><title>' + current.title + '</title></head><body><main><h1>' +
    current.title + '</h1>' + current.paragraphs.map(text => '<p>' + text + '</p>').join('') + '<a href="/research/field-notes.pdf">Field notes.pdf</a></main></body></html>'
  await context.route('https://example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: articleHtml() }))
  const demo = await context.newPage()
  await demo.goto(articleUrl)
  const settings = await context.newPage()
  for (const locale of ['zh-CN', 'en']) {
    current = content[locale]
    await demo.reload()
    await worker.evaluate(async ({ locale, current, articleUrl }) => {
      const windows = await chrome.windows.getAll({})
      const windowId = windows.find(item => !item.incognito).id
      const records = [{
        id: 'demo-page', signature: 'demo-page', title: current.title, url: articleUrl,
        summary: { overview: current.overview, points: current.points.map((text, index) => ({ text, evidenceIds: [index ? 3 : 1] })) },
        evidence: current.paragraphs.map((text, index) => ({ id: index + 1, text })), at: Date.now(),
        selected: false, limited: false,
      }, {
        id: 'demo-selection', signature: 'demo-selection', title: current.title, url: articleUrl,
        summary: { overview: current.selection, points: [{ text: current.points[1], evidenceIds: [3] }] },
        evidence: [{ id: 3, text: current.paragraphs[2] }], at: Date.now() - 3600000, selected: true, limited: false,
      }]
      await chrome.storage.local.set({
        onboardingCompleted: true, uiLocale: locale, allowCloud: true,
        foxmoriAccount: { id: 1, label: 'demo@example.test' },
        credential: { key: 'screenshot-demo-only', label: 'demo@example.test · Demo' }, model: 'Demo model',
        'foxmind-summary-archive': { generation: '', entries: records },
      })
      await chrome.storage.session.set({ ['foxmind-current-summaries-' + windowId]: { generation: '', page: 'demo-page', selection: 'demo-selection' } })
    }, { locale, current, articleUrl })
    await settings.goto(base + '/options.html')
    await settings.locator('#archiveEntries .archive-item').first().waitFor()
    await settings.screenshot({ path: join(output, '02-settings-' + locale + '.png') })
    await settings.locator('#archiveEntries .archive-item').first().click()
    await settings.getByRole('dialog').waitFor()
    await settings.screenshot({ path: join(output, '03-archive-' + locale + '.png') })
    await settings.keyboard.press('Escape')

    const stage = await context.newPage()
    await stage.goto(base + '/options.html')
    await stage.locator('#archiveEntries .archive-item').first().waitFor()
    await stage.evaluate(({ current, base }) => {
      const article = document.createElement('article')
      article.style.cssText = 'font:18px/1.9 system-ui,sans-serif;color:#243a2c;max-width:670px;margin:54px auto;padding:0 28px'
      const meta = document.createElement('p')
      meta.textContent = current.intro
      meta.style.cssText = 'font-size:13px;color:#60725c;letter-spacing:.04em'
      const title = document.createElement('h1')
      title.textContent = current.title
      title.style.cssText = 'font-size:38px;line-height:1.3;margin:20px 0 28px'
      article.append(meta, title)
      for (const text of current.paragraphs) {
        const p = document.createElement('p')
        p.textContent = text
        p.style.margin = '0 0 23px'
        article.append(p)
      }
      const note = document.createElement('p')
      note.textContent = current.demo + ' · example.test'
      note.style.cssText = 'font-size:12px;color:#64735e;margin-top:36px'
      article.append(note)
      const main = document.createElement('main')
      main.style.cssText = 'width:884px;height:800px;overflow:hidden;background:#fffdf7'
      main.append(article)
      const panel = document.createElement('iframe')
      panel.id = 'actualPanel'
      panel.src = base + '/sidepanel.html'
      panel.title = 'Foxmind'
      panel.style.cssText = 'width:396px;height:800px;border:0;border-left:1px solid #dce1d3;background:#f6f5ec'
      const layout = document.createElement('div')
      layout.style.cssText = 'display:flex;width:1280px;height:800px;background:#fffdf7'
      layout.append(main, panel)
      document.body.className = ''
      document.body.style.cssText = 'margin:0;overflow:hidden'
      document.body.replaceChildren(layout)
    }, { current, base })
    await demo.bringToFront()
    const frame = stage.frameLocator('#actualPanel')
    await frame.locator('#summaryResult .overview').waitFor()
    await frame.locator('#pageTitle').getByText(current.title, { exact: true }).waitFor()
    await stage.screenshot({ path: join(output, '01-sidepanel-' + locale + '.png') })
    await stage.close()
  }

  const promo = await context.newPage()
  const iconData = 'data:image/svg+xml;base64,' + Buffer.from(await readFile('public/icons/foxmind.svg')).toString('base64')
  for (const [name, width, height] of [['promo-small-440x280.png', 440, 280], ['promo-marquee-1400x560.png', 1400, 560]]) {
    await promo.setViewportSize({ width, height })
    await promo.setContent('<html><body style="margin:0;background:#294e3b;color:#fff5df;font-family:system-ui,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center;gap:24px"><img width="' +
      (width === 440 ? 100 : 200) + '" src="' + iconData + '"><div style="font-size:' + (width === 440 ? 44 : 86) + 'px;font-weight:750;letter-spacing:-.04em">Foxmind</div></body></html>')
    await promo.screenshot({ path: join(output, name) })
  }
  for (const locale of ['zh-CN', 'en']) {
    for (const prefix of ['01-sidepanel', '02-settings', '03-archive']) {
      const file = join(output, prefix + '-' + locale + '.png')
      const metadata = await sharp(file).metadata()
      assert.equal(metadata.width, 1280)
      assert.equal(metadata.height, 800)
      await sharp(file).removeAlpha().png().toFile(file + '.opaque')
      await rm(file)
      await cp(file + '.opaque', file)
      await rm(file + '.opaque')
    }
  }
  console.log(output)
} finally {
  await context.close()
  await rm(temporary, { recursive: true, force: true })
}
