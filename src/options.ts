import './style.css'
import './settings.css'
import template from './setup.html?raw'
import { getSavedAccount, issueKey, openConsole, readAccount, type Account } from './account'
import { initializeSummaryArchiveSettings } from './archive-settings'
import {
  applyAvailableModels, sameCredentialVersion, saveCredentialConfig, saveSelectedModel, type CredentialSnapshot,
} from './credential-store'
import { checkFoxdown, normalizeServer, serverPermission } from './foxdown'
import { getSettings, FoxmindError, type Credential, type Settings } from './shared'
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
  el<HTMLButtonElement>('next').disabled = step === 0 && (!key || !settings.model || !settings.allowCloud)
}

function receiveSettings(next: Settings) {
  const changed = !sameCredentialVersion(settings, next)
  settings = next
  if (changed) models = []
  if (next.model && !models.includes(next.model)) models.push(next.model)
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

async function refreshModels(configuration: CredentialSnapshot) {
  if (!configuration.credential) throw new FoxmindError('invalidKey')
  const visible = await fetchModels(configuration.credential.key)
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

void initialize().catch(error => status(accountStatus, errorCopy(error)))

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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    const next = { ...settings }
    for (const key of ['credential', 'credentialRevision', 'model'] as const) {
      if (changes[key]) Object.assign(next, { [key]: changes[key].newValue })
    }
    if ('credential' in changes || 'credentialRevision' in changes || 'model' in changes) {
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
    manualKey.value = ''
    void perform(accountStatus, async () => {
      if (!/^[^\s•*]{1,512}$/.test(key)) throw new FoxmindError('invalidKey')
      await saveCredential({ key })
    })
  })
  loadButton.addEventListener('click', () => {
    const configuration = settings
    if (configuration.credential) void perform(modelStatus, () => refreshModels(configuration))
  })
  removeButton.addEventListener('click', () => {
    void perform(modelStatus, async () => {
      await saveCredentialConfig(null)
      await reloadSettings()
      status(accountStatus)
      status(modelStatus, t('setupSaved'))
    })
  })
  for (const control of [model, language, allowCloud]) {
    control.addEventListener('change', async () => {
      const patch: Partial<Settings> = control === language ? { language: language.value as Settings['language'] }
        : { allowCloud: allowCloud.checked }
      try {
        if (control === model) {
          await saveSelectedModel(model.value, settings)
          await reloadSettings()
        } else {
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
  void connect(true)
}
