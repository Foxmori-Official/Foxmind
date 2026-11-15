import { actionKey, type PageAction } from './shared'
import { watchPage } from './capture'
import { privateArchiveKey, windowSummariesKey } from './summary-archive'

type PanelEvent = chrome.events.Event<(info: { windowId: number }) => void>
const sidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
  close?: (options: { windowId: number }) => Promise<void>
  onOpened?: PanelEvent
  onClosed?: PanelEvent
}

const canClosePanel = Boolean(sidePanel.close && sidePanel.onOpened && sidePanel.onClosed)
const visible = new Map<number, boolean>()
const visibilityKey = (windowId: number) => 'foxmind-panel-visible-' + windowId
const restoring = new Map<number, { clicks: number; tab: chrome.tabs.Tab }>()

void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})
// Older browsers can toggle natively. The custom action keeps the activeTab grant on newer ones.
void sidePanel.setPanelBehavior({ openPanelOnActionClick: !canClosePanel }).catch(() => {})

function rememberVisibility(windowId: number, isVisible: boolean) {
  visible.set(windowId, isVisible)
  const key = visibilityKey(windowId)
  const saved = isVisible ? chrome.storage.session.set({ [key]: true }) : chrome.storage.session.remove(key)
  void saved.catch(() => {})
}

if (canClosePanel) {
  sidePanel.onOpened?.addListener(({ windowId }) => rememberVisibility(windowId, true))
  sidePanel.onClosed?.addListener(({ windowId }) => rememberVisibility(windowId, false))
}

function refreshCurrentPage(tab: chrome.tabs.Tab) {
  if (tab.id == null) return
  const action: PageAction = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    url: tab.url ?? '',
    at: Date.now(),
  }
  void chrome.storage.session.set({ [actionKey(tab.windowId)]: action }).catch(() => {})
  if (/^https?:\/\//i.test(action.url)) void watchPage(action.tabId, action.url).catch(() => {})
}

async function closePanel(windowId: number) {
  visible.set(windowId, false)
  await sidePanel.close?.({ windowId })
}

chrome.action.onClicked.addListener(tab => {
  const { windowId } = tab
  if (tab.id == null || windowId < 0) return

  const pending = restoring.get(windowId)
  if (pending) {
    pending.clicks++
    pending.tab = tab
    return
  }
  const isVisible = visible.get(windowId)
  const forget = () => { visible.delete(windowId) }
  if (canClosePanel && isVisible) {
    void closePanel(windowId).catch(forget)
    return
  }

  if (!canClosePanel || isVisible === false) {
    if (canClosePanel) visible.set(windowId, true)
    void sidePanel.open({ windowId }).then(() => refreshCurrentPage(tab)).catch(forget)
    return
  }

  // Read before opening so an onOpened event cannot replace the previous state.
  // Calling open in this gesture is safe when the panel is already visible.
  const key = visibilityKey(windowId)
  const saved = chrome.storage.session.get(key).then(values => values[key] === true, () => false)
  const toggle = { clicks: 1, tab }
  restoring.set(windowId, toggle)
  void Promise.all([saved, sidePanel.open({ windowId })]).then(async ([wasVisible]) => {
    if (restoring.get(windowId) !== toggle) return
    restoring.delete(windowId)
    const shouldStayOpen = toggle.clicks % 2 === 0 ? wasVisible : !wasVisible
    if (shouldStayOpen) refreshCurrentPage(toggle.tab)
    else await closePanel(windowId)
  }).catch(() => {
    restoring.delete(windowId)
    forget()
  })
})

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install' && details.reason !== 'update') return
  void chrome.storage.local.get('onboardingCompleted').then(saved => {
    if (!saved.onboardingCompleted) return chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  })
})

chrome.windows.onRemoved.addListener(windowId => {
  restoring.delete(windowId)
  visible.delete(windowId)
  const privateKey = privateArchiveKey(windowId)
  void navigator.locks.request(privateKey, () => chrome.storage.session.remove([
    actionKey(windowId), visibilityKey(windowId), privateKey, windowSummariesKey(windowId),
  ])).catch(() => {})
})
