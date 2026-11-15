import './style.css'
import './settings.css'
import template from './setup.html?raw'
import { getSavedAccount, issueKey, openConsole, readAccount, type Account } from './account'
import { initializeSummaryArchiveSettings } from './archive-settings'
import { aiPermission, getAIService, validateCustomAI } from './ai-service'
import {
  applyAvailableModels, sameCredentialVersion, saveCredentialConfig, saveCustomAIConfig, saveSelectedModel, saveSummaryPermission,
  switchAIProvider, type CredentialSnapshot,
} from './credential-store'
import { checkFoxdown, normalizeServer, serverPermission } from './foxdown'
import { getSettings, FoxmindError, type AIProvider, type AIService, type Credential, type Settings } from './shared'
import { fetchModels } from './summary'
import { el, errorCopy, initializeLocale, t } from './ui'

el('setup').innerHTML = template
const onboarding = location.pathname.endsWith('/onboarding.html')
const accountLabel = el('accountLabel')
const groups = el<HTMLSelectElement>('group')
const model = el<HTMLSelectElement>('model')
const language = el<HTMLSelectElement>('language')
const allowCloud = el<HTMLInputElement>('allowCloud')
const credentialStatus = el('credentialStatus')
const accountStatus = el('accountStatus')
const modelStatus = el('modelStatus')
const serverStatus = el('serverStatus')
const foxdownUrl = el<HTMLInputElement>('foxdownUrl')
const foxdownToken = el<HTMLInputElement>('foxdownToken')
const manualKey = el<HTMLInputElement>('manualKey')
const readButton = el<HTMLButtonElement>('readAccount')
const issueButton = el<HTMLButtonElement>('issueKey')
const loadButton = el<HTMLButtonElement>('refreshModels')
const removeButton = el<HTMLButtonElement>('removeKey')
const saveKeyButton = el<HTMLButtonElement>('saveKey')
const provider = el<HTMLSelectElement>('aiProvider')
const customBaseUrl = el<HTMLInputElement>('customBaseUrl')
const customKey = el<HTMLInputElement>('customKey')
const customModel = el<HTMLInputElement>('customModel')
const customStatus = el('customAIStatus')
const customLoad = el<HTMLButtonElement>('customLoadModels')
const customSave = el<HTMLButtonElement>('saveCustomAI')
const customRemove = el<HTMLButtonElement>('removeCustomAI')

let account: Account | undefined
let lastAccount: string | undefined
let settings: Settings
let models: string[] = []
let busy = false
let returningFromConsole = false
let step = 0
let credentialUpdates = 0

function status(element: HTMLElement, message = '') {
  element.textContent = message
  element.hidden = !message
}

function renderAccount() {
  const label = account?.label || lastAccount || settings.credential?.label
  accountLabel.hidden = !label
  accountLabel.textContent = label ?? ''
  el('accountAvatar').textContent = label ? (Array.from(label)[0] || 'F').toUpperCase() : 'F'
  el('accountState').textContent = t(account ? 'currentAccount' : label ? 'lastAccount' : 'noAccount')
  el('accountGroups').hidden = !account?.groups.length
  const previous = groups.value
  groups.replaceChildren(new Option(t('selectGroup'), ''))
  for (const group of account?.groups ?? []) groups.add(new Option(group.name, String(group.id)))
  if (account?.groups.length === 1) groups.value = String(account.groups[0].id)
  else if (account?.groups.some(group => String(group.id) === previous)) groups.value = previous
  issueButton.disabled = !groups.value || busy
}

function renderSettings() {
  const custom = settings.provider === 'custom'
  provider.value = settings.provider
  provider.disabled = busy
  el('foxmoriSettings').hidden = custom
  el('customAISettings').hidden = !custom
  el('foxmoriModelField').hidden = custom
  for (const control of [customBaseUrl, customKey, customModel, customLoad, customSave, customRemove]) control.disabled = busy
  customRemove.hidden = !settings.customAI
  const key = settings.credential
  const owner = account?.label || lastAccount
  const prefix = owner ? owner + ' · ' : ''
  const keyLabel = prefix && key?.label?.startsWith(prefix) ? key.label.slice(prefix.length) : key?.label
  credentialStatus.textContent = key
    ? t('keyReady') + (keyLabel ? ' · ' + keyLabel : '')
    : t('keyMissing')
  credentialStatus.toggleAttribute('data-connected', Boolean(key))
  model.replaceChildren(new Option(t('selectModel'), ''))
  for (const item of models) model.add(new Option(item, item))
  model.value = settings.model
  model.disabled = busy || !models.length
  removeButton.hidden = !key
  loadButton.disabled = busy || !key
  removeButton.disabled = busy
  const service = getAIService(settings)
  const destination = service ? t('summaryDestination') + ' · ' + new URL(service.baseUrl).host + (service.model ? ' · ' + service.model : '') : ''
  status(el('summaryDestination'), destination)
  el<HTMLButtonElement>('next').disabled = step === 0 && (!service?.model || !settings.allowCloud)
}

function renderCustomConfig() {
  customBaseUrl.value = settings.customAI?.baseUrl ?? ''
  customKey.value = settings.customAI?.key ?? ''
  customModel.value = settings.customAI?.model ?? ''
  el('customModels').replaceChildren()
}

function receiveSettings(next: Settings) {
  const changed = !sameCredentialVersion(settings, next)
  const customChanged = JSON.stringify(settings.customAI) !== JSON.stringify(next.customAI) || settings.provider !== next.provider
  settings = next
  if (changed) models = []
  if (next.model && !models.includes(next.model)) models.push(next.model)
  allowCloud.checked = next.allowCloud
  language.value = next.language
  if (customChanged) {
    renderCustomConfig()
    status(customStatus)
  }
  renderAccount()
  renderSettings()
}

async function reloadSettings() {
  const before = credentialUpdates
  const latest = await getSettings()
  if (credentialUpdates === before) receiveSettings(latest)
}

function renderStep() {
  for (const section of document.querySelectorAll<HTMLElement>('[data-step]')) {
    section.hidden = Number(section.dataset.step) !== step
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-go-step]')) {
    if (Number(button.dataset.goStep) === step) button.setAttribute('aria-current', 'step')
    else button.removeAttribute('aria-current')
  }
  el('wizardControls').hidden = step === 2
  el('settingsColumns').hidden = step === 2
  el<HTMLDetailsElement>('existingKey').open = false
  el<HTMLButtonElement>('back').disabled = step === 0
  renderSettings()
}

function renderServer() {
  const connected = Boolean(settings.foxdownUrl)
  const badge = el('serverBadge')
  badge.textContent = t(connected ? 'serverSaved' : 'serverNotConnected')
  badge.toggleAttribute('data-connected', connected)
  el<HTMLButtonElement>('disconnectServer').disabled = !connected
}

async function perform(messageElement: HTMLElement, operation: () => Promise<void>, silent = false) {
  if (busy) return
  busy = true
  readButton.disabled = saveKeyButton.disabled = issueButton.disabled = true
  groups.disabled = true
  renderSettings()
  if (!silent) status(messageElement, t('working'))
  try {
    await operation()
  } catch (error) {
    if (error instanceof FoxmindError && error.code === 'credentialChanged') await reloadSettings()
    const consoleClosed = error instanceof FoxmindError && error.code === 'consoleTabRequired'
    if (!silent || (!consoleClosed && (lastAccount || settings.credential?.label))) status(messageElement, errorCopy(error))
  } finally {
    busy = false
    readButton.disabled = saveKeyButton.disabled = groups.disabled = false
    renderAccount()
    renderSettings()
  }
}

async function connect(silent = false) {
  await perform(accountStatus, async () => {
    account = undefined
    renderAccount()
    account = await readAccount()
    lastAccount = account.label
    status(accountStatus, account.groups.length ? '' : t('noGroups'))
  }, silent)
}

async function refreshModels(configuration: Settings) {
  const service = getAIService(configuration)
  if (!service) throw new FoxmindError('invalidKey')
  const visible = await fetchModels(service)
  const saved = await applyAvailableModels(visible, configuration)
  await reloadSettings()
  if (!sameCredentialVersion(settings, saved)) throw new FoxmindError('credentialChanged')
  models = visible
  renderSettings()
  status(modelStatus)
}

async function saveCredential(credential: Credential, expected?: CredentialSnapshot) {
  const saved = await saveCredentialConfig(credential, expected)
  await reloadSettings()
  if (!sameCredentialVersion(settings, saved)) throw new FoxmindError('credentialChanged')
  status(accountStatus, t('keyReady'))
  try {
    await refreshModels(saved)
  } catch (error) {
    status(modelStatus, errorCopy(error, 'modelUnavailable'))
  }
}

function customOperation(operation: (service: AIService, expected: Settings) => Promise<void>) {
  if (busy) return
  let service: AIService
  try {
    service = validateCustomAI({ baseUrl: customBaseUrl.value, key: customKey.value, model: customModel.value })
  } catch (error) {
    status(customStatus, errorCopy(error))
    return
  }
  const expected = settings
  void perform(customStatus, async () => {
    const granted = await chrome.permissions.request({ origins: [aiPermission(service.baseUrl)] })
    if (!granted) throw new FoxmindError('aiPermission')
    if (!sameCredentialVersion(await getSettings(), expected)) throw new FoxmindError('credentialChanged')
    await operation(service, expected)
  })
}

void initialize().catch(error => status(modelStatus, errorCopy(error)))

async function initialize() {
  await initializeLocale()
  const [storedSettings, savedAccount] = await Promise.all([getSettings(), getSavedAccount()])
  settings = storedSettings
  lastAccount = savedAccount?.label
  foxdownUrl.value = settings.foxdownUrl || 'http://127.0.0.1:16801'
  foxdownToken.value = settings.foxdownToken
  language.value = settings.language
  el<HTMLSelectElement>('uiLocale').value = settings.uiLocale
  allowCloud.checked = settings.allowCloud
  models = settings.model ? [settings.model] : []
  renderCustomConfig()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    const next = { ...settings }
    const keys = ['credential', 'credentialRevision', 'model', 'provider', 'customAI', 'allowCloud', 'language'] as const
    for (const key of keys) {
      if (changes[key]) Object.assign(next, { [key]: changes[key].newValue })
    }
    if (keys.some(key => key in changes)) {
      credentialUpdates++
      receiveSettings(next)
    }
  })
  el('steps').hidden = !onboarding
  el('setupIntroGroup').hidden = !onboarding
  el('settingsTitle').hidden = onboarding
  el('reopenGuide').hidden = onboarding
  document.title = 'Foxmind · ' + t(onboarding ? 'welcome' : 'settings')
  if (onboarding) {
    renderStep()
  } else {
    for (const section of document.querySelectorAll<HTMLElement>('[data-step]:not(#ready)')) section.hidden = false
    el('summaryArchiveSettings').hidden = false
    renderSettings()
    void initializeSummaryArchiveSettings().catch(error => status(el('archiveStatus'), errorCopy(error)))
  }
  renderAccount()
  renderServer()

  provider.addEventListener('change', () => {
    const next = provider.value as AIProvider
    const expected = settings
    void perform(modelStatus, async () => {
      await switchAIProvider(next, expected)
      await reloadSettings()
      status(modelStatus, t('providerSaved'))
    }).then(() => {
      if (settings.provider === 'foxmori') void connect(true)
    })
  })
  customLoad.addEventListener('click', () => {
    customOperation(async (service, expected) => {
      let available: string[]
      try { available = await fetchModels(service) } catch (error) {
        if (!sameCredentialVersion(await getSettings(), expected)) throw new FoxmindError('credentialChanged')
        status(customStatus, errorCopy(error) + ' ' + t('customModelHint'))
        return
      }
      await reloadSettings()
      if (!sameCredentialVersion(settings, expected)) throw new FoxmindError('credentialChanged')
      el('customModels').replaceChildren(...available.map(id => new Option(id, id)))
      if (!customModel.value.trim() && available.length === 1) customModel.value = available[0]
      status(customStatus, t('customModelsReady'))
    })
  })
  el<HTMLFormElement>('customAIForm').addEventListener('submit', event => {
    event.preventDefault()
    customOperation(async (service, expected) => {
      await saveCustomAIConfig(service, expected)
      await reloadSettings()
      status(customStatus, t('customAISaved'))
    })
  })
  customRemove.addEventListener('click', () => {
    const expected = settings
    void perform(customStatus, async () => {
      await saveCustomAIConfig(null, expected)
      await reloadSettings()
      status(customStatus, t('customAIRemoved'))
    })
  })
  el('uiLocale').addEventListener('change', async () => {
    await chrome.storage.local.set({ uiLocale: el<HTMLSelectElement>('uiLocale').value })
    location.reload()
  })
  el('reopenGuide').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }))
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-go-step]')) {
    button.addEventListener('click', () => { step = Number(button.dataset.goStep); renderStep() })
  }
  el('back').addEventListener('click', () => { step = Math.max(0, step - 1); renderStep() })
  el('next').addEventListener('click', () => { step = Math.min(2, step + 1); renderStep() })
  el('later').addEventListener('click', () => { step = 2; renderStep() })
  el('finish').addEventListener('click', async () => {
    await chrome.storage.local.set({ onboardingCompleted: true })
    const tab = await chrome.tabs.getCurrent()
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id)
  })

  el('openConsole').addEventListener('click', async () => {
    returningFromConsole = true
    try { await openConsole() } catch (error) { status(accountStatus, errorCopy(error, 'consoleUnavailable')) }
  })
  const verifyOnReturn = () => {
    if (!returningFromConsole || document.visibilityState !== 'visible') return
    returningFromConsole = false
    void connect()
  }
  window.addEventListener('focus', verifyOnReturn)
  document.addEventListener('visibilitychange', verifyOnReturn)
  readButton.addEventListener('click', () => void connect())
  groups.addEventListener('change', () => { issueButton.disabled = !groups.value || busy })
  issueButton.addEventListener('click', () => {
    const selected = account
    const group = selected?.groups.find(item => String(item.id) === groups.value)
    if (!selected || !group) return
    void perform(accountStatus, async () => {
      const expected = await getSettings()
      const key = await issueKey(selected.id, group.id).catch(error => {
        if (error instanceof FoxmindError && ['accountChanged', 'loginRequired', 'consoleTabRequired'].includes(error.code)) {
          account = undefined
        }
        throw error
      })
      await saveCredential({ key, label: selected.label + ' · ' + group.name }, expected)
    })
  })

  el<HTMLFormElement>('manualForm').addEventListener('submit', event => {
    event.preventDefault()
    const key = manualKey.value.trim()
    const expected = settings
    manualKey.value = ''
    void perform(accountStatus, async () => {
      if (!/^[^\s•*]{1,512}$/.test(key)) throw new FoxmindError('invalidKey')
      await saveCredential({ key }, expected)
    })
  })
  loadButton.addEventListener('click', () => {
    const configuration = settings
    if (configuration.credential) void perform(modelStatus, () => refreshModels(configuration))
  })
  removeButton.addEventListener('click', () => {
    const expected = settings
    void perform(modelStatus, async () => {
      await saveCredentialConfig(null, expected)
      await reloadSettings()
      status(accountStatus)
      status(modelStatus, t('setupSaved'))
    })
  })
  for (const control of [model, language, allowCloud]) {
    control.addEventListener('change', async () => {
      try {
        if (control === model) {
          await saveSelectedModel(model.value, settings)
          await reloadSettings()
        } else if (control === allowCloud) {
          await saveSummaryPermission(allowCloud.checked, settings)
          await reloadSettings()
        } else {
          const patch = { language: language.value as Settings['language'] }
          await chrome.storage.local.set(patch)
          settings = { ...settings, ...patch }
        }
        status(modelStatus, t('setupSaved'))
        renderSettings()
      } catch (error) {
        if (error instanceof FoxmindError && error.code === 'credentialChanged') await reloadSettings()
        status(modelStatus, errorCopy(error))
      }
    })
  }

  el<HTMLFormElement>('serverForm').addEventListener('submit', async event => {
    event.preventDefault()
    const button = el<HTMLButtonElement>('connectServer')
    button.disabled = true
    status(serverStatus, t('working'))
    try {
      const url = normalizeServer(foxdownUrl.value)
      // Request the selected server origin while the submit gesture is active.
      const allowed = await chrome.permissions.request({ origins: [serverPermission(url)] })
      if (!allowed) throw new FoxmindError('serverPermission')
      const token = foxdownToken.value.trim()
      await checkFoxdown(url, token)
      await chrome.storage.local.set({ foxdownUrl: url, foxdownToken: token })
      settings = { ...settings, foxdownUrl: url, foxdownToken: token }
      foxdownUrl.value = url
      renderServer()
      status(serverStatus, t('serverConnected'))
    } catch (error) {
      status(serverStatus, errorCopy(error))
    } finally {
      button.disabled = false
    }
  })
  el('disconnectServer').addEventListener('click', async () => {
    try {
      await chrome.storage.local.set({ foxdownUrl: '', foxdownToken: '' })
      settings = { ...settings, foxdownUrl: '', foxdownToken: '' }
      foxdownUrl.value = ''
      foxdownToken.value = ''
      renderServer()
      status(serverStatus, t('serverDisconnected'))
    } catch (error) {
      status(serverStatus, errorCopy(error))
    }
  })
  if (settings.provider === 'foxmori') void connect(true)
}
