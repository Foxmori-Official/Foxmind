import './style.css'
import { getAIService } from './ai-service'
import { downloadExport } from './export-download'
import { mergeResources, networkResources, queueResource } from './foxdown'
import { captureExport, type ExportFormat } from './page-export'
import { readPageResources } from './page-resources'
import {
  actionKey, FoxmindError, getSettings, isWebUrl, type DirectResource, type PageIdentity, type PageSnapshot, type Settings,
} from './shared'
import { prepareInput, summarize } from './summary'
import {
  archiveArea, archiveKey, emptyArchive, readArchive, readWindowSummaries, reuseFor, saveSummary,
  type ArchiveScope, type SummaryArchive, type SummaryKind, type SummaryRecord,
} from './summary-archive'
import { summaryContents } from './summary-view'
import { el, errorCopy, initializeLocale, localize, t, uiLanguage } from './ui'

interface ActivePage {
  tabId: number
  url: string
  readable?: boolean
}

function summaryPanel(kind: SummaryKind, prefix: string, buttonId: string, prompt: string) {
  return {
    kind, prompt, message: prompt,
    button: el<HTMLButtonElement>(buttonId),
    status: el(prefix + 'Status'),
    source: el(prefix + 'Source'),
    link: el<HTMLAnchorElement>(prefix + 'Link'),
    coverage: el(prefix + 'Coverage'),
    result: el(prefix + 'Result'),
    copy: el<HTMLButtonElement>(prefix + 'Copy'),
    configure: el<HTMLButtonElement>(prefix + 'Configure'),
    retry: el<HTMLButtonElement>(prefix + 'Retry'),
    displayed: undefined as SummaryRecord | undefined,
    request: undefined as AbortController | undefined,
    configuration: undefined as Settings | undefined,
  }
}

type SummaryPanel = ReturnType<typeof summaryPanel>
const summaries = [
  summaryPanel('page', 'summary', 'summarizePage', 'panelReady'),
  summaryPanel('selection', 'selection', 'selection', 'noSelection'),
]
const exportMenu = el<HTMLDetailsElement>('exportMenu')
const exportButtons = document.querySelectorAll<HTMLButtonElement>('[data-export-format]')
const refresh = el<HTMLButtonElement>('refreshResources')
const showAll = el<HTMLButtonElement>('showAll')
const resourceSection = el('resourceSection')
const resourceList = el('resources')
const resourceStatus = el('resourceStatus')
const handoffStatus = el('handoffStatus')

let windowId: number
let archiveScope: ArchiveScope
let activeTab: chrome.tabs.Tab | undefined
let activePage: ActivePage | undefined
let tabQuery = 0
let settingsGeneration = 0
const summarySettingKeys = ['allowCloud', 'credential', 'credentialRevision', 'model', 'provider', 'customAI', 'language', 'uiLocale'] as const
let setupMessage = 'configure'
let archiveGeneration = emptyArchive.generation
let exporting = false
let resourceRequest = 0
let scanning = false
let resourceRows: HTMLElement[] = []
let expanded = false

function showStatus(element: HTMLElement, value = '') {
  element.textContent = value
  element.hidden = !value
}

function summaryStatus(panel: SummaryPanel, key: string, options: { setup?: boolean; retry?: boolean } = {}) {
  panel.message = key
  panel.configure.hidden = !options.setup
  panel.configure.dataset.msg = key === 'summaryPermissionRequired' ? 'settings' : 'openSettings'
  panel.configure.textContent = t(panel.configure.dataset.msg)
  panel.retry.hidden = !options.retry
  showStatus(panel.status, key ? t(key) : '')
}

function paintControls() {
  const pageReady = !!activePage && activePage.readable !== undefined
  for (const panel of summaries) panel.button.disabled = panel.retry.disabled = !pageReady
  for (const button of exportButtons) button.disabled = !pageReady || exporting
  refresh.disabled = !pageReady || scanning
}

function displaySummary(panel: SummaryPanel, entry?: SummaryRecord) {
  panel.displayed = entry
  panel.result.replaceChildren(...(entry ? summaryContents(entry) : []))
  panel.source.hidden = !entry
  const { link } = panel
  if (entry) {
    link.href = entry.url
    link.textContent = entry.title || new URL(entry.url).hostname
  } else {
    link.removeAttribute('href')
    link.textContent = ''
  }
  showStatus(panel.coverage, entry?.limited ? t('partial') : '')
  panel.copy.hidden = !entry
  panel.copy.textContent = t('copy')
}

function cancelSummary(panel: SummaryPanel) {
  panel.request?.abort()
  panel.request = undefined
  panel.configuration = undefined
}

async function readSummarySettings(): Promise<Settings> {
  for (;;) {
    const generation = settingsGeneration
    const settings = await getSettings()
    if (generation === settingsGeneration) return settings
  }
}

function updateArchiveGeneration(generation: string) {
  if (generation === archiveGeneration) return
  archiveGeneration = generation
  for (const panel of summaries) {
    cancelSummary(panel)
    displaySummary(panel)
    summaryStatus(panel, panel.prompt)
  }
}

async function assertActivePage(target: ActivePage) {
  const [tab] = await chrome.tabs.query({ windowId, active: true })
  if (activePage !== target || tab?.id !== target.tabId || tab.url !== target.url ||
      (tab.pendingUrl && tab.pendingUrl !== target.url)) throw new FoxmindError('pageChanged')
}

// Permission requests must run in the side panel's button gesture.
async function requestPageAccess(target: ActivePage): Promise<boolean> {
  if (target.readable) return false
  const origin = new URL(target.url).origin + '/*'
  const granted = await chrome.permissions.request({ origins: [origin] })
    .catch(() => { throw new FoxmindError('blockedPage') })
  if (!granted) throw new FoxmindError('pagePermission')
  return true
}

async function captureSummary(target: ActivePage, useSelection: boolean): Promise<PageSnapshot> {
  const tab = { tabId: target.tabId, frameIds: [0] }
  if (useSelection) {
    const [injection] = await chrome.scripting.executeScript({
      target: tab,
      func: () => ({
        url: location.href,
        title: document.title.trim().slice(0, 300),
        text: window.getSelection()?.toString().trim().slice(0, 64_000) ?? '',
      }),
    }).catch(() => { throw new FoxmindError('blockedPage') })
    const selected = injection?.result
    if (selected?.url !== target.url) throw new FoxmindError('pageChanged')
    if (!selected.text) throw new FoxmindError('noSelection')
    return {
      url: selected.url,
      title: selected.title,
      paragraphs: (selected.text.match(/[\s\S]{1,1600}/g) ?? []).map(text => ({ text })),
      limited: selected.text.length === 64_000,
    }
  }

  const [injection] = await chrome.scripting.executeScript({ target: tab, files: ['page.js'] })
    .catch(() => { throw new FoxmindError('blockedPage') })
  const snapshot = injection?.result as PageSnapshot | undefined
  if (snapshot?.url !== target.url) throw new FoxmindError('pageChanged')
  if (!snapshot.paragraphs.length) throw new FoxmindError('noText')
  return snapshot
}

async function generate(panel: SummaryPanel) {
  const target = activePage
  if (!target) return
  const useSelection = panel.kind === 'selection'
  cancelSummary(panel)
  const generation = archiveGeneration
  const request = new AbortController()
  panel.request = request
  const isCurrent = () => panel.request === request
  let timeout: ReturnType<typeof setTimeout> | undefined
  summaryStatus(panel, 'reading')
  try {
    const needsRescan = await requestPageAccess(target)
    await assertActivePage(target)
    if (!isCurrent()) return
    const settings = await readSummarySettings()
    if (!isCurrent()) return
    panel.configuration = settings
    const required = summarySetupMessage(settings)
    const service = getAIService(settings)
    if (required || !service) {
      summaryStatus(panel, required || 'configure', { setup: true })
      return
    }

    if (needsRescan) void loadResources(target)
    const snapshot = await captureSummary(target, useSelection)
    await assertActivePage(target)
    if (!isCurrent()) return

    const input = prepareInput(snapshot.title, snapshot.paragraphs, snapshot.limited)
    const language = settings.language === 'auto' ? uiLanguage() : settings.language
    const fingerprint = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify([service.baseUrl, service.key, service.model, language, target.url, useSelection, input])),
    )
    const signature = [...new Uint8Array(fingerprint)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const stored = await readArchive(archiveScope)
    if (!isCurrent() || stored.generation !== generation) return
    let entry = stored.entries.find(entry => entry.signature === signature && Date.now() - entry.at < reuseFor)
    const fresh = !entry
    if (!entry) {
      summaryStatus(panel, 'generating')
      timeout = setTimeout(() => request.abort(new FoxmindError('modelTimeout')), 40_000)
      const summary = await summarize(service, language === 'zh' ? 'Simplified Chinese' : 'English', input, request.signal)
      clearTimeout(timeout)
      const ids = new Set(summary.points.flatMap(point => point.evidenceIds))
      entry = {
        id: crypto.randomUUID(), signature, summary, title: snapshot.title, url: target.url, selected: useSelection, limited: input.limited,
        evidence: input.paragraphs.filter(paragraph => ids.has(paragraph.id)), at: Date.now(),
      }
    }
    if (!isCurrent()) return
    const saved = await saveSummary(archiveScope, entry, generation, fresh, request.signal).catch(() => null)
    if (!isCurrent()) return
    if (saved === false) {
      summaryStatus(panel, 'archiveChanged', { retry: true })
      return
    }
    displaySummary(panel, entry)
    summaryStatus(panel, saved === null ? 'archiveSaveFailed' : '')
  } catch (error) {
    if (!isCurrent()) return
    const reason = request.signal.reason ?? error
    const code = reason instanceof FoxmindError ? reason.code : 'modelFailed'
    summaryStatus(panel, code, { retry: true, setup: code === 'invalidKey' || code === 'modelUnavailable' })
  } finally {
    clearTimeout(timeout)
    if (isCurrent()) {
      panel.request = undefined
      panel.configuration = undefined
    }
  }
}

function makeResourceRow(name: string, meta: string, action: HTMLElement): HTMLElement {
  const row = document.createElement('li')
  row.className = 'resource-row'
  const contents = document.createElement('div')
  const title = document.createElement('div')
  title.className = 'resource-name'
  title.title = name
  title.textContent = name
  const details = document.createElement('div')
  details.className = 'resource-meta'
  details.textContent = meta
  contents.append(title, details)
  row.append(contents, action)
  return row
}

function directRow(item: DirectResource): HTMLElement {
  const link = document.createElement('a')
  link.className = 'button'
  link.href = item.url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = t('openLink')
  return makeResourceRow(item.name, item.type + ' · ' + new URL(item.url).hostname, link)
}

function foxdownRow(item: DirectResource, target: ActivePage, identity: PageIdentity): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = t('download')
  button.setAttribute('aria-label', t('download') + ' · ' + item.name)
  button.addEventListener('click', async () => {
    if (activePage !== target) return
    button.disabled = true
    button.textContent = t('sending')
    showStatus(handoffStatus)
    try {
      const settings = await getSettings()
      await assertActivePage(target)
      await queueResource(settings.foxdownUrl, settings.foxdownToken, identity, item)
      if (activePage !== target) return
      button.textContent = '✓'
      showStatus(handoffStatus, t('queued'))
    } catch (error) {
      if (activePage !== target) return
      button.disabled = false
      button.textContent = t('download')
      showStatus(handoffStatus, errorCopy(error, 'downloadFailed'))
    }
  })
  const size = item.size && item.size > 0 ? ' · ' + new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(item.size / 1_048_576) + ' MB' : ''
  return makeResourceRow(item.name, item.type + ' · ' + new URL(item.url).hostname + size, button)
}

function paintRows() {
  resourceList.replaceChildren(...(expanded ? resourceRows : resourceRows.slice(0, 4)))
  showStatus(el('resourceCount'), String(resourceRows.length))
  showAll.hidden = resourceRows.length <= 4
  showAll.textContent = t(expanded ? 'showLess' : 'showAll')
  showAll.setAttribute('aria-expanded', String(expanded))
}

async function loadResources(target: ActivePage, interactive = false) {
  if (activePage !== target) return
  const sequence = ++resourceRequest
  const isCurrent = () => activePage === target && sequence === resourceRequest
  scanning = true
  paintControls()
  showStatus(handoffStatus)
  showStatus(resourceStatus, t('readingResources'))
  try {
    if (interactive) await requestPageAccess(target)
    if (!isCurrent()) return
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [0] },
      func: readPageResources,
      injectImmediately: true,
    }).catch(() => {
      if (isCurrent()) target.readable = false
      throw new FoxmindError(interactive ? 'blockedPage' : 'refreshForAccess')
    })
    if (!isCurrent()) return
    const snapshot = injection?.result
    if (snapshot?.url !== target.url || !injection.documentId) throw new FoxmindError('pageChanged')
    target.readable = true
    paintControls()
    const identity = { tabId: target.tabId, documentId: injection.documentId, pageUrl: target.url }
    const [settings, network] = await Promise.all([getSettings(), networkResources(identity)])
    if (!isCurrent()) return
    resourceRows = mergeResources(snapshot.resources, network)
      .map(item => settings.foxdownUrl ? foxdownRow(item, target, identity) : directRow(item))
    showStatus(resourceStatus, !settings.foxdownUrl ? t('noServer') : resourceRows.length ? '' : t('noResources'))
  } catch (error) {
    if (!isCurrent()) return
    target.readable ??= false
    showStatus(resourceStatus, errorCopy(error))
  } finally {
    if (isCurrent()) {
      scanning = false
      paintRows()
      paintControls()
    }
  }
}

function paintPageHeading() {
  const site = activePage ? new URL(activePage.url).hostname : ''
  el('pageTitle').textContent = activePage ? activeTab?.title || site : t('panelTitle')
  showStatus(el('pageHost'), site)
  showStatus(el('pageStatus'), activeTab && !activePage ? t('blockedPage') : '')
}

function selectTab(tab?: chrome.tabs.Tab, reload = false) {
  activeTab = tab
  const url = tab?.url ?? ''
  const supported = tab?.id !== undefined && isWebUrl(url)
  if (!reload && activePage && supported && activePage.tabId === tab.id && activePage.url === url) {
    paintPageHeading()
    return
  }

  activePage = supported ? { tabId: tab.id!, url } : undefined
  resourceRequest++
  scanning = false
  expanded = false
  resourceRows = []
  paintRows()
  paintPageHeading()
  showStatus(el('exportStatus'))
  showStatus(handoffStatus)
  exportMenu.open = false
  exportMenu.hidden = resourceSection.hidden = !activePage
  paintControls()
  if (activePage) void loadResources(activePage)
}

async function followActiveTab() {
  const query = ++tabQuery
  const [tab] = await chrome.tabs.query({ windowId, active: true })
  if (query === tabQuery) selectTab(tab)
}

async function exportPage(format: ExportFormat) {
  const target = activePage
  if (!target || exporting) return
  exporting = true
  exportMenu.open = false
  paintControls()
  const status = el('exportStatus')
  showStatus(status, t('exporting'))
  try {
    const needsRescan = await requestPageAccess(target)
    await assertActivePage(target)
    if (needsRescan) void loadResources(target)
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [0] },
      func: captureExport,
      args: [format],
    }).catch(() => { throw new FoxmindError('blockedPage') })
    await assertActivePage(target)
    if (!injection?.result) throw new FoxmindError('exportFailed')
    if (injection.result.url !== target.url) throw new FoxmindError('pageChanged')
    downloadExport(injection.result.title, injection.result.content, format)
    showStatus(status, t('exportSaved'))
  } catch (error) {
    if (activePage === target) showStatus(status, errorCopy(error, 'exportFailed'))
  } finally {
    exporting = false
    paintControls()
  }
}

function summarySetupMessage(settings: Settings): string {
  if (!getAIService(settings)?.model) return 'configure'
  return settings.allowCloud ? '' : 'summaryPermissionRequired'
}

async function updateConfigured() {
  const settings = await readSummarySettings()
  setupMessage = summarySetupMessage(settings)
  const service = getAIService(settings)
  showStatus(el('serviceTarget'), service ? t('summaryDestination') + ' · ' + new URL(service.baseUrl).host + (service.model ? ' · ' + service.model : '') : '')
  for (const panel of summaries) {
    if (panel.message === 'configure' || panel.message === 'summaryPermissionRequired') {
      summaryStatus(panel, setupMessage || (panel.displayed ? '' : panel.prompt), { setup: Boolean(setupMessage) })
    }
  }
}

localize()
el('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage())
for (const panel of summaries) {
  panel.configure.addEventListener('click', () => void chrome.runtime.openOptionsPage())
  panel.button.addEventListener('click', () => void generate(panel))
  panel.retry.addEventListener('click', () => void generate(panel))
  panel.copy.addEventListener('click', () => void copySummary(panel))
}
for (const button of exportButtons) {
  button.addEventListener('click', () => void exportPage(button.dataset.exportFormat as ExportFormat))
}
refresh.addEventListener('click', () => { if (activePage) void loadResources(activePage, true) })
showAll.addEventListener('click', () => { expanded = !expanded; paintRows() })
async function copySummary(panel: SummaryPanel) {
  const entry = panel.displayed
  if (!entry) return
  const { summary } = entry
  const text = [summary.overview, ...summary.points.map((point, index) => (index + 1) + '. ' + point.text)].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    if (panel.displayed === entry) panel.copy.textContent = t('copied')
  } catch {
    const range = document.createRange()
    range.selectNodeContents(panel.result)
    const selected = getSelection()
    selected?.removeAllRanges()
    selected?.addRange(range)
  }
}

void initialize().catch(error => showStatus(el('pageStatus'), errorCopy(error)))

async function initialize() {
  await Promise.all([initializeLocale(), updateConfigured()])
  const currentWindow = await chrome.windows.getCurrent()
  if (currentWindow.id == null) return
  windowId = currentWindow.id
  archiveScope = { windowId, incognito: currentWindow.incognito }
  const toolbarKey = actionKey(windowId)
  const historyKey = archiveKey(archiveScope)
  const historyArea = archiveArea(archiveScope)
  let startupArchive: SummaryArchive | undefined | null

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === historyArea && changes[historyKey]) {
      const next: SummaryArchive = changes[historyKey].newValue ?? emptyArchive
      if (startupArchive !== null) startupArchive = next
      updateArchiveGeneration(next.generation)
    }
    if (area === 'session' && changes[toolbarKey]?.newValue) {
      void followActiveTab().then(() => {
        if (activePage && !scanning) void loadResources(activePage)
      })
    }
    if (area !== 'local') return
    if (summarySettingKeys.some(key => key in changes)) {
      settingsGeneration++
      for (const panel of summaries) {
        if (!panel.request || !panel.configuration) continue
        // Storage notifications can arrive after a request has read the new
        // configuration. Only invalidate a request still using older values.
        if (!summarySettingKeys.some(key => key in changes &&
          JSON.stringify(panel.configuration![key]) !== JSON.stringify(changes[key].newValue))) continue
        cancelSummary(panel)
        summaryStatus(panel, 'summarySettingsChanged', { retry: true })
      }
      void updateConfigured()
    }
    if ('uiLocale' in changes) void initializeLocale().then(() => {
      void updateConfigured()
      paintPageHeading()
      for (const panel of summaries) {
        showStatus(panel.status, panel.message ? t(panel.message) : '')
        displaySummary(panel, panel.displayed)
      }
      if (activePage) void loadResources(activePage)
    })
    if (activePage && ('foxdownUrl' in changes || 'foxdownToken' in changes)) void loadResources(activePage)
  })
  const savedArchive = await readArchive(archiveScope)
  const initial = startupArchive ?? savedArchive
  startupArchive = null
  archiveGeneration = initial.generation
  const restored = await readWindowSummaries(archiveScope, initial)
  if (archiveGeneration === initial.generation) {
    for (const panel of summaries) {
      const entry = restored[panel.kind]
      if (!entry || panel.request || panel.displayed) continue
      displaySummary(panel, entry)
      summaryStatus(panel, '')
    }
  }
  chrome.tabs.onActivated.addListener(({ windowId: activatedWindow }) => {
    if (activatedWindow !== windowId) return
    selectTab()
    void followActiveTab()
  })
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.windowId !== windowId || !tab.active) return
    tabQuery++
    const before = activePage
    selectTab(tab, change.status === 'loading')
    if (before && activePage === before && before.tabId === tabId && change.status === 'complete') {
      void loadResources(before)
    }
  })
  chrome.tabs.onRemoved.addListener(tabId => {
    if (activeTab?.id !== tabId) return
    selectTab()
    void followActiveTab()
  })
  window.addEventListener('pagehide', () => summaries.forEach(cancelSummary), { once: true })
  await followActiveTab()
}
