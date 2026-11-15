import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, cp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const temp = await mkdtemp(join(tmpdir(), 'foxmind-browser-'))
const profile = join(temp, 'profile')
const keyPath = join(temp, 'key.pem')
const certPath = join(temp, 'cert.pem')
const site = 'https://foxmori.com'
const fixtureKey = 'fixture-summary-key'
const fixtureManualKey = 'fixture-manual-key'
const serverToken = 'fixture-server-token'
const mediaUrl = '/stream.m3u8?token=fixture-media'
const selectedSentence = 'Local volunteers counted bird species in the wetland'
const modelCalls = []
const customCalls = []
const downloads = []
let keyIssued = false
let pauseNextSummary
let pauseNextKeyReply
let pauseNextModelsReply

function delayedReply() {
  let resume
  const wait = new Promise(resolve => { resume = resolve })
  return { wait, resume, started: false }
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function listen(server) {
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  return server.address().port
}

async function close(server) {
  server?.closeAllConnections()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
}

async function eventually(check, label, limit = 10_000) {
  const end = Date.now() + limit
  while (Date.now() < end) {
    const result = await check()
    if (result) return result
    await delay(80)
  }
  throw new Error('Timed out: ' + label)
}

async function connectProtocol() {
  const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')
  const socket = new WebSocket('ws://127.0.0.1:' + port + path)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data)
    const callback = pending.get(reply.id)
    if (!callback) return
    pending.delete(reply.id)
    if (reply.error) callback.reject(new Error(reply.error.message))
    else callback.resolve(reply.result)
  })
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('DevTools disconnected'))
    pending.clear()
  })
  return {
    close: () => socket.close(),
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    }),
  }
}

const article = '<!doctype html><title>Forest Restoration Study</title><base href="/files/">' +
  '<style>.hidden-copy{display:none}</style><nav>Unrelated navigation</nav>' +
  '<article><h1>Forest Restoration Study</h1><p>' +
  'The watershed team planted native trees near the river to study how shade affects seasonal water temperature. ' +
  'They collected temperature and rainfall observations at several sites every week throughout the summer.</p>' +
  '<p>The field team found that shaded sites stayed cooler in the afternoon. These findings are based on measured temperatures.</p>' +
  '<p class="hidden-copy">PRIVATE_HIDDEN_TEXT</p><p>Original text<tv-translation data-tv-owned>TRANSLATED_DUPLICATE</tv-translation></p>' +
  '<p><tv-translation data-tv-owned class="tv-tr-replace">TRANSLATED_ONLY<template class="tv-backup">Recovered original text.</template></tv-translation></p>' +
  '<a href="report.pdf?case=fixture#page=1" download>Report</a>' +
  '<a href="report.pdf?case=fixture#page=2">Duplicate</a></article><form><input value="PRIVATE_FORM"></form>'

const alternate = '<!doctype html><title>Coastal Wetland Survey</title><base href="/field-notes/">' +
  '<nav>Site navigation</nav><main><h1>Coastal Wetland Survey</h1>' +
  '<p>Local volunteers counted bird species in the wetland at several locations, including the mouth of the river. ' +
  'They recorded each observation in a field notebook and used the same route in each survey.</p>' +
  '<p><a href="field-guide.html" onclick="return true">Field guide</a> and <a href="javascript:void(0)">note</a></p>' +
  '<table><thead><tr><th>Site</th><th>Count</th></tr></thead><tbody><tr><td>River</td><td>12</td></tr></tbody></table>' +
  '<pre><code class="language-python">print("wetlands")</code></pre>' +
  '<p style="display:none">PRIVATE_HIDDEN_EXPORT</p><form><input value="PRIVATE_FORM_EXPORT"></form></main>' +
  '<script>document.querySelector("h1").dataset.rendered = "fixture"</script>'

let context
let protocol
let secureServer
let localServer
try {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath,
    '-sha256', '-days', '1', '-nodes', '-subj', '/CN=foxmori.com',
  ], { stdio: 'ignore' })

  secureServer = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, async (req, res) => {
    if (req.headers.host === 'api.foxmori.com') {
      const manual = req.headers.authorization === 'Bearer ' + fixtureManualKey
      if (!manual && req.headers.authorization !== 'Bearer ' + fixtureKey) return json(res, {}, 401)
      if (req.url === '/v1/models') {
        const paused = pauseNextModelsReply
        pauseNextModelsReply = undefined
        if (paused) {
          paused.started = true
          await paused.wait
        }
        return json(res, { data: [{ id: manual ? 'fixture-manual-chat' : 'fixture-chat' }] })
      }
      if (req.url === '/v1/chat/completions') {
        const request = JSON.parse(await body(req))
        const source = JSON.parse(request.messages[1].content)
        modelCalls.push(source)
        if (pauseNextSummary) {
          const pause = pauseNextSummary
          pauseNextSummary = undefined
          await pause
        }
        const evidence = source.paragraphs.find(item => item.text.includes('watershed')) ?? source.paragraphs[0]
        const selection = source.paragraphs.length === 1 && source.paragraphs[0].text === selectedSentence
        const overview = selection ? 'Volunteers counted wetland birds.'
          : source.title.includes('Wetland') ? 'Volunteers recorded wetland bird species.'
          : 'Native trees helped keep the river cooler.'
        const response = { overview, points: [{ text: 'The team recorded observations.', evidenceIds: [evidence.id] }] }
        return json(res, { choices: [{ message: { content: JSON.stringify(response) } }] })
      }
      return json(res, {}, 404)
    }
    if (!req.url.startsWith('/api/console/')) {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>Foxmori fixture</title><base href="https://unrelated.example/">')
      return
    }
    if (!req.headers.cookie?.split(';').some(cookie => cookie.trim() === 'fm_access=fixture-session')) return json(res, {}, 401)
    let result
    if (req.url === '/api/console/user/profile') result = { id: 12, email: 'fixture@example.test' }
    else if (req.url === '/api/console/groups/available') result = [{ id: 7, name: 'Fixture group' }]
    else if (req.url === '/api/console/foxmind/key' && req.method === 'POST') {
      const requested = JSON.parse(await body(req))
      if (requested.account_id !== 12 || requested.group_id !== 7) return json(res, {}, 409)
      keyIssued = true
      result = { key: fixtureKey }
    } else return json(res, {}, 404)
    if (req.url === '/api/console/foxmind/key' && pauseNextKeyReply) {
      const paused = pauseNextKeyReply
      pauseNextKeyReply = undefined
      paused.started = true
      await paused.wait
    }
    json(res, { code: 0, data: result })
  })
  const httpsPort = await listen(secureServer)

  localServer = createServer(async (req, res) => {
    if (req.url.startsWith('/ai/v1/') || req.url.startsWith('/local/v1/')) {
      const local = req.url.startsWith('/local/')
      if (!local && req.headers.authorization !== 'Bearer ' + fixtureKey) return json(res, {}, 401)
      if (req.url.endsWith('/models')) return local ? json(res, {}, 404) : json(res, { data: [{ id: 'fixture-chat' }] })
      if (req.url.endsWith('/chat/completions')) {
        const request = JSON.parse(await body(req))
        const source = JSON.parse(request.messages[1].content)
        customCalls.push({ url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie, request, source })
        const response = { overview: local ? 'Local model summary.' : 'Custom service summary.',
          points: [{ text: 'The source describes field observations.', evidenceIds: [source.paragraphs[0].id] }] }
        return json(res, { choices: [{ message: { content: JSON.stringify(response) } }] })
      }
      return json(res, {}, 404)
    }
    if (req.url === mediaUrl) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      return res.end('#EXTM3U\n')
    }
    if (req.url.startsWith('/api/')) {
      if (req.headers.authorization !== 'Bearer ' + serverToken) return json(res, {}, 401)
      if (req.url === '/api/v1/health') return json(res, { ok: true, app: 'foxdown', aria2: true })
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        const task = JSON.parse(await body(req))
        downloads.push({ url: task.url, options: task.options })
        return json(res, { id: 'fixture-task-' + downloads.length })
      }
      return json(res, {}, 404)
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(req.url === '/alternate' ? alternate : article)
  })
  const origin = 'http://127.0.0.1:' + await listen(localServer)
  const pageOrigin = origin.replace('127.0.0.1', 'localhost')
  const articleUrl = pageOrigin + '/article'
  const alternateUrl = origin + '/alternate'
  const extensions = join(temp, 'extension')
  await cp(resolve('dist'), extensions, { recursive: true })
  const manifestPath = join(extensions, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  // Pregrant only the disposable loopback server. Native permission prompts
  // are outside the automated extension-page context.
  manifest.host_permissions.push('http://127.0.0.1/*')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const launchOptions = {
    executablePath: chromium.executablePath(),
    headless: process.env.FOXMIND_HEADLESS === '1',
    locale: 'en-US',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--disable-extensions-except=' + extensions, '--load-extension=' + extensions,
      '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
      '--ignore-certificate-errors', '--no-proxy-server', '--lang=en-US',
      '--host-resolver-rules=MAP foxmori.com 127.0.0.1:' + httpsPort +
        ', MAP api.foxmori.com 127.0.0.1:' + httpsPort + ', MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
  }
  context = await chromium.launchPersistentContext(profile, launchOptions)
  protocol = await connectProtocol()
  const installed = (await protocol.send('Extensions.getExtensions')).extensions
  const mind = installed.find(item => item.name === 'Foxmind')
  assert.ok(mind)
  assert.equal(installed.length, 1)
  const mindBase = 'chrome-extension://' + mind.id
  const findWorker = () => context.serviceWorkers().find(worker => worker.url() === mindBase + '/background.js')
  let worker = await eventually(findWorker, 'Foxmind worker')
  assert.equal(await worker.evaluate(() => chrome.action.onClicked.hasListeners()), true, 'Foxmind toolbar handler is registered')

  const consolePage = await context.newPage()
  await context.addCookies([{ name: 'fm_access', value: 'fixture-session', domain: 'foxmori.com',
    path: '/api/console/', secure: true, httpOnly: true, sameSite: 'Strict' }])
  await consolePage.goto(site + '/#models')

  let options = await context.newPage()
  await options.goto(mindBase + '/options.html')
  await options.locator('#readAccount').waitFor()
  const guide = await eventually(() => context.pages().find(page => page.url() === mindBase + '/onboarding.html'), 'automatic installation guide')
  await guide.bringToFront()
  await guide.locator('#uiLocale').selectOption('zh-CN')
  await guide.waitForFunction(() => document.documentElement.lang === 'zh')
  assert.equal(await guide.locator('#setupTitle').textContent(), '读懂网页，收好资源。')
  assert.equal(await guide.locator('#summaryArchiveSettings').isHidden(), true)
  assert.equal(await guide.locator('#manualKey').isHidden(), true)
  assert.equal(await guide.locator('#allowCloud').isVisible(), true)
  assert.equal(await guide.locator('#allowCloud').isChecked(), false)
  await guide.locator('#existingKey > summary').click()
  assert.equal(await guide.locator('#manualKey').isVisible(), true)
  await guide.locator('#existingKey > summary').click()
  const layout = await guide.locator('.settings-body').boundingBox()
  const contentWidth = await guide.evaluate(() => document.documentElement.clientWidth)
  assert.ok(Math.abs(layout.x + layout.width / 2 - contentWidth / 2) < 2)
  await guide.locator('#later').click()
  await guide.locator('#finish').click()
  await options.bringToFront()
  await options.reload()
  await options.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await options.getByRole('heading', { name: '狐森账号', exact: true }).waitFor()
  await options.getByRole('heading', { name: '摘要模型', exact: true }).waitFor()
  await options.getByRole('heading', { name: '连接 Foxdown', exact: true }).waitFor()
  await options.getByRole('heading', { name: '摘要存档', exact: true }).waitFor()
  assert.equal(await options.getByRole('navigation').count(), 0)
  const left = await options.locator('.settings-preferences').boundingBox()
  const right = await options.locator('#summaryArchiveSettings').boundingBox()
  assert.ok(left.x + left.width < right.x && Math.abs(left.y - right.y) < 2, 'settings and archive are side by side')
  await options.getByRole('searchbox', { name: '搜索摘要存档' }).waitFor()
  await options.locator('#uiLocale').selectOption('en')
  await options.waitForFunction(() => document.documentElement.lang === 'en')
  console.log('Automatic centered setup guide, English and Simplified Chinese passed')
  await options.locator('#readAccount').click()
  await options.waitForFunction(() => document.querySelector('#accountLabel').textContent === 'fixture@example.test' &&
    document.querySelector('#accountState').textContent === 'Signed-in account')
  await options.locator('#issueKey').click()
  await options.waitForFunction(() => document.querySelector('#model').value === 'fixture-chat')
  assert.ok(keyIssued)

  const editor = await context.newPage()
  await editor.goto(mindBase + '/options.html')
  await editor.waitForFunction(() => document.querySelector('#accountState')?.textContent === 'Signed-in account' &&
    !document.querySelector('#readAccount').disabled)
  async function saveManualKey(key, expectedModel) {
    await editor.bringToFront()
    if (!await editor.locator('#existingKey').evaluate(details => details.open)) {
      await editor.locator('#existingKey > summary').click()
    }
    await editor.locator('#manualKey').fill(key)
    await editor.locator('#saveKey').click()
    await editor.waitForFunction(expected => document.querySelector('#model').value === expected &&
      !document.querySelector('#saveKey').disabled, expectedModel)
  }

  async function startIssuance() {
    const paused = delayedReply()
    pauseNextKeyReply = paused
    await options.bringToFront()
    await options.locator('#issueKey').click()
    await eventually(() => paused.started, 'key issuance response is delayed')
    return paused
  }

  async function expectIssuanceDiscarded(paused) {
    paused.resume()
    await options.waitForFunction(() => document.querySelector('#accountStatus').textContent.includes('latest settings have been kept') &&
      !document.querySelector('#readAccount').disabled)
  }

  const delayedIssuance = await startIssuance()
  await saveManualKey(fixtureManualKey, 'fixture-manual-chat')
  await expectIssuanceDiscarded(delayedIssuance)
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('credential')).credential.key), fixtureManualKey)
  assert.equal(await options.locator('#model').inputValue(), 'fixture-manual-chat')

  const delayedModels = delayedReply()
  pauseNextModelsReply = delayedModels
  await options.bringToFront()
  await options.locator('#refreshModels').click()
  await eventually(() => delayedModels.started, 'old key model response is delayed')
  await saveManualKey(fixtureKey, 'fixture-chat')
  delayedModels.resume()
  await options.waitForFunction(() => document.querySelector('#modelStatus').textContent.includes('latest settings have been kept') &&
    !document.querySelector('#readAccount').disabled)
  assert.equal(await options.locator('#model').inputValue(), 'fixture-chat')

  const removedWhilePending = await startIssuance()
  await editor.bringToFront()
  await editor.locator('#removeKey').click()
  await editor.waitForFunction(async () => (await chrome.storage.local.get('credential')).credential === null)
  await expectIssuanceDiscarded(removedWhilePending)
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('credential')).credential), null)

  await saveManualKey(fixtureKey, 'fixture-chat')
  const restoredWhilePending = await startIssuance()
  await editor.bringToFront()
  await editor.locator('#removeKey').click()
  await editor.waitForFunction(() => document.querySelector('#model').value === '' && !document.querySelector('#saveKey').disabled)
  await saveManualKey(fixtureKey, 'fixture-chat')
  await expectIssuanceDiscarded(restoredWhilePending)
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('credential')).credential.label), undefined)
  assert.equal(await options.locator('#model').inputValue(), 'fixture-chat')

  await options.bringToFront()
  await options.locator('#issueKey').click()
  await options.waitForFunction(() => document.querySelector('#credentialStatus').textContent === 'API key connected · Fixture group' &&
    document.querySelector('#model').value === 'fixture-chat' && !document.querySelector('#readAccount').disabled)
  await editor.close()
  console.log('Two settings pages preserve newer manual keys, removals, restored keys and models against delayed responses')

  await options.close()
  await consolePage.close()
  options = await context.newPage()
  await options.goto(mindBase + '/options.html')
  await options.waitForFunction(() => document.querySelector('#accountLabel')?.textContent === 'fixture@example.test')
  assert.equal(await options.locator('#accountState').textContent(), 'Last connected account')
  assert.equal(await options.locator('#accountGroups').isHidden(), true)
  assert.equal(await options.locator('#model').inputValue(), 'fixture-chat')
  assert.equal(await options.locator('#credentialStatus').textContent(), 'API key connected · Fixture group')
  console.log('Foxmori session, key and account display after closing settings and console passed')

  await options.locator('#foxdownUrl').fill(origin)
  await options.locator('#foxdownToken').fill('wrong-token')
  await options.locator('#connectServer').click()
  await options.waitForFunction(() => document.querySelector('#serverStatus').textContent.includes('Check its Web API token'))
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('foxdownUrl')).foxdownUrl || ''), '')
  await options.locator('#foxdownToken').fill(serverToken)
  await options.locator('#connectServer').click()
  await options.waitForFunction(() => document.querySelector('#serverStatus').textContent === 'Connected to Foxdown.')

  const website = await context.newPage()
  await website.goto(articleUrl)
  await website.bringToFront()
  const targets = async () => (await protocol.send('Target.getTargets', { filter: [{}] })).targetInfos
  const tab = (await targets()).find(item => item.type === 'tab' && item.url === articleUrl)
  assert.ok(tab)
  const clickToolbar = () => protocol.send('Extensions.triggerAction', { id: mind.id, targetId: tab.targetId })
  await clickToolbar()

  await eventually(async () => await worker.evaluate(async url => Object.values(await chrome.storage.session.get(null))
    .some(item => item?.url === url), articleUrl), 'toolbar click reached the Foxmind worker')
  const panelUrl = mindBase + '/sidepanel.html'
  const findPanel = async () => (await targets()).find(target => target.url === panelUrl)
  async function attachPanel() {
    const panel = await eventually(findPanel, 'native side panel target')
    return (await protocol.send('Target.attachToTarget', { targetId: panel.targetId, flatten: true })).sessionId
  }
  let sessionId = await attachPanel()
  async function evaluate(expression) {
    const { result, exceptionDetails } = await protocol.send('Runtime.evaluate', {
      expression, returnByValue: true, userGesture: true,
    }, sessionId)
    if (exceptionDetails) throw new Error(exceptionDetails.text)
    return result.value
  }
  await eventually(() => evaluate('document.querySelectorAll(".resource-row").length === 1'), 'resource list in native side panel')
  assert.equal(modelCalls.length, 0)
  assert.equal(await evaluate('document.querySelector("#archiveHeading, #archiveCount, #clearArchive, #archiveEntries") === null'), true)
  assert.equal(await evaluate('document.querySelector("#selectionSection").previousElementSibling.getAttribute("aria-labelledby") === "summaryHeading" && document.querySelector("#selectionSection").nextElementSibling.id === "resourceSection"'), true)
  assert.equal(await evaluate('document.querySelector("#summaryResult").childElementCount'), 0)
  await evaluate('document.querySelector("#summarizePage").click()')
  await eventually(() => evaluate('document.querySelector("#summaryStatus").textContent.includes("Allow Foxmind to send page text")'), 'summary waits for page-content permission')
  assert.equal(modelCalls.length, 0)
  await options.bringToFront()
  await options.locator('#allowCloud').check()
  await options.waitForFunction(async () => (await chrome.storage.local.get('allowCloud')).allowCloud)
  await website.bringToFront()
  await eventually(() => evaluate('!document.querySelector("#summarizePage").disabled && document.querySelector("#summaryConfigure").hidden'), 'summary available after granting permission')
  await evaluate('document.querySelector("#summarizePage").click()')
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent.includes("Native trees")'), 'explicit summary in native side panel')
  await clickToolbar()
  await eventually(async () => !await findPanel(), 'second toolbar click closes the side panel')
  await clickToolbar()
  sessionId = await attachPanel()
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent.includes("Native trees")'), 'toolbar reopens the same summary')
  await eventually(() => evaluate('document.querySelectorAll(".resource-row").length === 1'), 'reopened panel can still read page resources')
  assert.equal(modelCalls.length, 1)

  const workerControls = await context.newPage()
  await workerControls.goto('chrome://serviceworker-internals')
  await workerControls.getByRole('button', { name: 'Stop', exact: true }).click()
  await workerControls.getByText('Running Status: STOPPED', { exact: true }).waitFor()
  await website.bringToFront()
  await clickToolbar()
  await eventually(async () => !await findPanel(), 'toolbar closes the panel after the worker restarts')
  worker = await eventually(findWorker, 'Foxmind worker restarted')
  await clickToolbar()
  sessionId = await attachPanel()
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent.includes("Native trees")'), 'panel can reopen again after worker restart')
  await workerControls.close()
  await website.evaluate(path => fetch(path, { headers: { Authorization: 'Bearer fixture-media-header' } }).then(r => r.text()), mediaUrl)
  await eventually(async () => worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null))
    .some(([key, value]) => key.startsWith('foxmind-resources-') && value.entries.length)), 'media request captured after toolbar click')
  await evaluate('document.querySelector("#refreshResources").click()')
  await eventually(() => evaluate('document.querySelectorAll(".resource-row").length === 2'), 'PDF and HLS resource rows')
  assert.equal(modelCalls.length, 1)
  assert.deepEqual(Object.keys(modelCalls[0]), ['title', 'paragraphs'])
  const modelText = JSON.stringify(modelCalls[0])
  assert.ok(modelText.includes('Recovered original text'))
  assert.doesNotMatch(modelText, /PRIVATE_|TRANSLATED_|fixture-media|report\.pdf/)
  assert.match(await evaluate('document.querySelector("blockquote").textContent'), /watershed/)
  assert.doesNotMatch(await evaluate('document.querySelector("#resources").outerHTML'), /fixture-media|Bearer/)

  await evaluate('[...document.querySelectorAll(".resource-row")].find(x => x.innerText.includes("HLS")).querySelector("button").click()')
  await eventually(() => downloads.length === 1, 'Foxdown download submission')
  assert.equal(downloads[0].url, pageOrigin + mediaUrl)
  assert.ok(downloads[0].options.headers.some(header => header.toLowerCase() === 'authorization: bearer fixture-media-header'))
  await evaluate('[...document.querySelectorAll(".resource-row")].find(x => x.innerText.includes("PDF")).querySelector("button").click()')
  await eventually(() => downloads.length === 2, 'Foxdown direct attachment submission')
  assert.equal(downloads[1].url, pageOrigin + '/files/report.pdf?case=fixture')
  console.log('Toolbar toggles across worker restart, summary evidence and Foxdown handoff passed')

  await website.evaluate(() => {
    history.pushState({}, '', '/changed')
    document.title = 'Forest route changed'
  })
  await eventually(() => evaluate('document.querySelector("#pageTitle").textContent === "Forest route changed"'), 'SPA navigation updates active title')
  assert.equal(await evaluate('document.querySelector("#summaryLink").href'), articleUrl)
  assert.match(await evaluate('document.querySelector("#summaryResult .overview").textContent'), /Native trees/)
  assert.equal(modelCalls.length, 1)
  await website.evaluate(url => {
    history.replaceState({}, '', url)
    document.title = 'Forest Restoration Study'
  }, articleUrl)
  await eventually(() => evaluate('document.querySelector("#pageTitle").textContent === "Forest Restoration Study" && !document.querySelector("#summarizePage").disabled'), 'return to source page')
  await evaluate('document.querySelector("#summaryResult .overview").dataset.previous = "1"')
  await evaluate('document.querySelector("#summarizePage").click()')
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.dataset.previous === undefined && document.querySelector("#summaryStatus").hidden'), 'explicit summary reuses matching cache')
  assert.equal(modelCalls.length, 1)

  const otherPage = await context.newPage()
  await otherPage.goto(alternateUrl)
  await otherPage.bringToFront()
  await eventually(() => evaluate('document.querySelector("#pageTitle").textContent === "Coastal Wetland Survey" && !document.querySelector("#summarizePage").disabled'), 'side panel tracks the new tab')
  assert.equal(await evaluate('document.querySelector("#summaryLink").href'), articleUrl)

  const exportDir = join(temp, 'exports')
  await mkdir(exportDir)
  await protocol.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: exportDir })
  async function checkExport(format, extension) {
    await evaluate('document.querySelector("#exportMenu > summary").click()')
    await evaluate('document.querySelector("[data-export-format=' + format + ']").click()')
    return await eventually(() => readFile(join(exportDir, 'Coastal Wetland Survey.' + extension), 'utf8').catch(() => ''),
      'downloaded ' + format)
  }
  const html = await checkExport('html', 'html')
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<h1 data-rendered="fixture">Coastal Wetland Survey<\/h1>/)
  assert.ok(html.includes('<base href="' + origin + '/field-notes/">'))
  assert.doesNotMatch(html, /forest|<script|onclick|javascript:|PRIVATE_FORM_EXPORT/i)
  const markdown = await checkExport('markdown', 'md')
  assert.match(markdown, /^# Coastal Wetland Survey/m)
  assert.ok(markdown.includes('[Field guide](' + origin + '/field-notes/field-guide.html)'))
  assert.match(markdown, /\| Site +\| Count +\|/)
  assert.match(markdown, /print\("wetlands"\)/)
  assert.doesNotMatch(markdown, /PRIVATE_|Site navigation|Volunteers recorded wetland bird species/)
  assert.equal(modelCalls.length, 1)
  console.log('HTML and Markdown export the current tab without a model call')

  await evaluate('document.querySelector("#summarizePage").click()')
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent.includes("Volunteers recorded")'), 'new explicit summary replaces the display')
  assert.equal(modelCalls.length, 2)
  assert.equal(await evaluate('document.querySelector("#summaryLink").href'), alternateUrl)
  await otherPage.evaluate(text => {
    const start = document.querySelector('main p').firstChild
    const range = document.createRange()
    range.setStart(start, 0)
    range.setEnd(start, text.length)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
  }, selectedSentence)
  await evaluate('document.querySelector("#selection").click()')
  await eventually(() => evaluate('document.querySelector("#selectionResult .overview")?.textContent === "Volunteers counted wetland birds."'), 'independent selection result')
  assert.match(await evaluate('document.querySelector("#summaryResult .overview").textContent'), /Volunteers recorded/)
  assert.deepEqual(modelCalls[2].paragraphs.map(({ text }) => text), [selectedSentence])

  await options.bringToFront()
  await options.waitForFunction(() => document.querySelector('#archiveCount').textContent === '3')
  const search = options.getByRole('searchbox', { name: 'Search summary archive' })
  await search.fill('unmatched fixture query')
  await options.getByText('No matching summaries', { exact: true }).waitFor()
  await search.fill('localhost')
  assert.equal(await options.locator('#archiveCount').textContent(), '1 / 3')
  await search.fill('FOREST restoration')
  const earlier = options.locator('#archiveEntries .archive-item').filter({ hasText: 'Forest Restoration Study' })
  await earlier.click()
  const reader = options.getByRole('dialog')
  await reader.waitFor()
  assert.match(await reader.locator('.overview').textContent(), /Native trees/)
  assert.equal(await reader.locator('#archiveSource').getAttribute('href'), articleUrl)
  await reader.getByText('View source text', { exact: true }).click()
  assert.match(await reader.locator('blockquote').innerText(), /watershed/)
  await reader.getByRole('button', { name: 'Close', exact: true }).click()

  await search.fill('counted wetland birds')
  assert.equal(await options.locator('#archiveCount').textContent(), '1 / 3')
  await options.locator('#archiveEntries .archive-item').filter({ hasText: 'Summary of selected text' }).click()
  await reader.waitFor()
  assert.match(await reader.locator('.overview').textContent(), /Volunteers counted/)
  await reader.getByRole('button', { name: 'Delete this summary', exact: true }).click()
  await options.waitForFunction(() => document.querySelector('#archiveCount').textContent === '0 / 2' &&
    !document.querySelector('#archiveReader').open)
  await search.fill('')
  assert.equal(await options.locator('#archiveCount').textContent(), '2')

  // A response already in flight cannot restore an archive the user clears.
  let finishSummary
  pauseNextSummary = new Promise(resolve => { finishSummary = resolve })
  await otherPage.bringToFront()
  await eventually(() => evaluate('document.querySelector("#pageTitle").textContent === "Coastal Wetland Survey" && !document.querySelector("#summarizePage").disabled'), 'return to tab ready for summary')
  await otherPage.evaluate(() => { document.querySelector('main p').textContent += ' The team also noted rising water levels.' })
  await evaluate('document.querySelector("#summarizePage").click()')
  await eventually(() => modelCalls.length === 4, 'new summary request is in flight')
  assert.match(await evaluate('document.querySelector("#summaryResult .overview").textContent'), /Volunteers recorded/)
  await options.bringToFront()
  await options.locator('#clearArchive').click()
  await options.locator('#archiveEmpty').waitFor()
  await eventually(() => evaluate('document.querySelector("#summarySource").hidden && document.querySelector("#selectionSource").hidden'), 'clearing archive clears displayed summaries')
  finishSummary()
  await otherPage.bringToFront()
  await eventually(() => evaluate('document.querySelector("#pageTitle").textContent === "Coastal Wetland Survey" && !document.querySelector("#summarizePage").disabled'), 'return after clearing the cache')
  await evaluate('document.querySelector("#summarizePage").click()')
  await eventually(() => evaluate('!document.querySelector("#summarySource").hidden'), 'fresh summary after clearing')
  await options.waitForFunction(() => document.querySelector('#archiveCount').textContent === '1')
  assert.equal(modelCalls.length, 5)
  console.log('Independent selection, archive search, reader, evidence, deletion and clearing passed')

  await options.bringToFront()
  await options.locator('#disconnectServer').click()
  await options.waitForFunction(async () => (await chrome.storage.local.get('foxdownUrl')).foxdownUrl === '')
  await website.bringToFront()
  await eventually(() => evaluate('Boolean(document.querySelector(".resource-row a"))'), 'direct-link fallback when Foxdown is disconnected')
  assert.equal(await evaluate('document.querySelector(".resource-row a").href'), pageOrigin + '/files/report.pdf?case=fixture')
  console.log('Direct-link fallback passed')

  async function summarizeArticle() {
    // Native tab activation and extension storage notifications are asynchronous.
    // A script click on a disabled button silently does nothing.
    await eventually(() => evaluate('document.querySelector("#pageTitle").textContent === "Forest Restoration Study" && !document.querySelector("#summarizePage").disabled && document.querySelector("#summaryConfigure").hidden'), 'article summary controls ready after switching tabs')
    await evaluate('document.querySelector("#summarizePage").click()')
  }

  // Use the same key and model at a different API base to verify cache isolation.
  await summarizeArticle()
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent.includes("Native trees")'), 'Foxmori summary before switching providers')
  const beforeCustom = modelCalls.length
  await options.bringToFront()
  await options.locator('#aiProvider').selectOption('custom')
  await options.waitForFunction(() => !document.querySelector('#customAISettings').hidden && !document.querySelector('#aiProvider').disabled)
  assert.equal(await options.locator('#allowCloud').isChecked(), false)
  await options.locator('#customBaseUrl').fill(origin + '/ai/v1/chat/completions')
  await options.locator('#customKey').fill(fixtureKey)
  await options.locator('#customLoadModels').click()
  await options.waitForFunction(() => document.querySelector('#customModel').value === 'fixture-chat' &&
    !document.querySelector('#saveCustomAI').disabled)
  await options.locator('#saveCustomAI').click()
  await options.waitForFunction(() => document.querySelector('#customAIStatus').textContent === 'AI service saved.' &&
    !document.querySelector('#aiProvider').disabled)
  assert.equal(await options.locator('#customBaseUrl').inputValue(), origin + '/ai/v1')
  assert.equal(await options.locator('#allowCloud').isChecked(), false)
  await options.locator('#allowCloud').check()
  await options.waitForFunction(async () => (await chrome.storage.local.get('allowCloud')).allowCloud)
  await website.bringToFront()
  await eventually(() => evaluate('document.querySelector("#serviceTarget").textContent.includes("127.0.0.1")'), 'custom destination in the side panel')
  await summarizeArticle()
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent === "Custom service summary."'), 'custom API summary replaces the page result')
    .catch(async error => { throw new Error(error.message + ' (' + JSON.stringify({
      status: await evaluate('document.querySelector("#summaryStatus").textContent'),
      page: await evaluate('document.querySelector("#pageTitle").textContent'),
      customCalls: customCalls.length,
    }) + ')') })
  assert.equal(modelCalls.length, beforeCustom)
  assert.equal(customCalls.length, 1)
  assert.equal(customCalls[0].request.model, 'fixture-chat')
  assert.equal(customCalls[0].authorization, 'Bearer ' + fixtureKey)
  assert.equal(customCalls[0].cookie, undefined)

  await website.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('article p'))
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
  })
  await evaluate('document.querySelector("#selection").click()')
  await eventually(() => evaluate('document.querySelector("#selectionResult .overview")?.textContent === "Custom service summary."'), 'custom API selection summary')
  assert.equal(customCalls.length, 2)

  await options.bringToFront()
  await options.locator('#aiProvider').selectOption('foxmori')
  await options.waitForFunction(() => !document.querySelector('#foxmoriSettings').hidden &&
    !document.querySelector('#aiProvider').disabled)
  assert.equal(await options.locator('#model').inputValue(), 'fixture-chat')
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('credential')).credential.key), fixtureKey)
  assert.equal(await options.locator('#allowCloud').isChecked(), false)
  await options.locator('#allowCloud').check()
  await options.waitForFunction(async () => (await chrome.storage.local.get('allowCloud')).allowCloud)
  await website.bringToFront()
  await eventually(() => evaluate('document.querySelector("#serviceTarget").textContent.includes("api.foxmori.com")'), 'switch restores Foxmori destination')
  await summarizeArticle()
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent.includes("Native trees")'), 'Foxmori uses its own cached result')
    .catch(async error => { throw new Error(error.message + ' (' + JSON.stringify({
      status: await evaluate('document.querySelector("#summaryStatus").textContent'),
      page: await evaluate('document.querySelector("#pageTitle").textContent'),
      overview: await evaluate('document.querySelector("#summaryResult .overview")?.textContent'),
      modelCalls: modelCalls.length,
    }) + ')') })
  assert.equal(modelCalls.length, beforeCustom)

  await options.bringToFront()
  await options.locator('#aiProvider').selectOption('custom')
  await options.waitForFunction(() => !document.querySelector('#customAISettings').hidden && !document.querySelector('#aiProvider').disabled)
  assert.equal(await options.locator('#customBaseUrl').inputValue(), origin + '/ai/v1')
  await options.locator('#customBaseUrl').fill(origin + '/local/v1')
  await options.locator('#customKey').fill('')
  await options.locator('#customLoadModels').click()
  await options.waitForFunction(() => document.querySelector('#customAIStatus').textContent.includes('enter a model ID directly') &&
    !document.querySelector('#saveCustomAI').disabled)
  await options.locator('#customModel').fill('local-model')
  await options.locator('#saveCustomAI').click()
  await options.waitForFunction(() => document.querySelector('#customAIStatus').textContent === 'AI service saved.')
  await options.locator('#allowCloud').check()
  await options.waitForFunction(async () => (await chrome.storage.local.get('allowCloud')).allowCloud)
  await website.bringToFront()
  await eventually(() => evaluate('document.querySelector("#serviceTarget").textContent.includes("local-model")'), 'saved local model appears in the panel')
  await summarizeArticle()
  await eventually(() => evaluate('document.querySelector("#summaryResult .overview")?.textContent === "Local model summary."'), 'manual model without a models endpoint or API key')
    .catch(async error => { throw new Error(error.message + ' (' + await evaluate('document.querySelector("#summaryStatus").textContent') + ')') })
  assert.equal(customCalls.at(-1).authorization, undefined)
  assert.equal(customCalls.at(-1).request.model, 'local-model')
  console.log('Custom models, direct summaries, selection, provider switching, cache isolation and keyless local API passed')

  protocol.close()
  protocol = undefined
  await context.close()
  context = await chromium.launchPersistentContext(profile, launchOptions)
  const reopened = await context.newPage()
  await reopened.goto(mindBase + '/options.html')
  await reopened.getByRole('heading', { name: /^Summary archive/ }).waitFor()
  assert.equal(await reopened.locator('#aiProvider').inputValue(), 'custom')
  assert.equal(await reopened.locator('#customBaseUrl').inputValue(), origin + '/local/v1')
  assert.equal(await reopened.locator('#customKey').inputValue(), '')
  assert.equal(await reopened.locator('#customModel').inputValue(), 'local-model')
  await reopened.locator('#archiveEntries .archive-item').filter({ hasText: 'Coastal Wetland Survey' }).click()
  await reopened.getByRole('dialog').waitFor()
  assert.match(await reopened.locator('#archiveReadBody .overview').textContent(), /Volunteers recorded/)
  console.log('Archive remains readable after restarting the browser')
} finally {
  protocol?.close()
  await context?.close()
  await Promise.all([close(secureServer), close(localServer)])
  await rm(temp, { recursive: true, force: true })
}
