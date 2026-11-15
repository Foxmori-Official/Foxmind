import { CONSOLE, FoxmindError, SITE } from './shared'

export interface Account {
  id: number
  label: string
  groups: { id: number; name: string }[]
}

type AccountIdentity = Pick<Account, 'id' | 'label'>
const accountKey = 'foxmoriAccount'

export async function getSavedAccount(): Promise<AccountIdentity | undefined> {
  const saved = (await chrome.storage.local.get(accountKey))[accountKey]
  if (!Number.isSafeInteger(saved?.id) || saved.id < 1 || typeof saved.label !== 'string' || !saved.label.trim()) return
  return { id: saved.id, label: saved.label }
}

type Operation = { type: 'account' } | { type: 'key'; accountId: number; groupId: number }
type Result = { account: Account } | { key: string } | { error: string }

// Executed in the isolated world of the first-party tab. This uses the
// console's HttpOnly session and the same lock as Foxtranslate.
async function inFoxmoriTab(operation: Operation): Promise<Result> {
  const origin = 'https://foxmori.com'
  if (location.origin !== origin || window !== window.top) return { error: 'consoleUnavailable' }
  const signal = AbortSignal.timeout(20_000)

  async function call(path: string, body?: Record<string, number>) {
    const response = await fetch(origin + '/api/console/' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
    if (response.status === 401) throw new Error('loginRequired')
    if (response.status === 409) throw new Error('accountChanged')
    if (response.status === 403) throw new Error('groupUnavailable')
    if (response.status === 404 && path === 'foxmind/key') throw new Error('issuerUnavailable')
    const data = await response.json()
    if (!response.ok || data?.code !== 0) throw new Error('consoleUnavailable')
    return data.data
  }

  try {
    return await navigator.locks.request('foxmori-console-session', { signal }, async () => {
      if (operation.type === 'key') {
        const response = await call('foxmind/key', { account_id: operation.accountId, group_id: operation.groupId })
        const key = response?.key
        if (typeof key !== 'string' || !/^[^\s•*]{1,512}$/.test(key)) return { error: 'issuerUnavailable' }
        return { key }
      }
      const profile = await call('user/profile')
      if (!Number.isSafeInteger(profile?.id) || profile.id < 1) return { error: 'loginRequired' }
      const response = await call('groups/available')
      const groups: { id: number; name?: string }[] =
        Array.isArray(response) ? response : Array.isArray(response?.items) ? response.items : []
      return {
        account: {
          id: profile.id,
          label: String(profile.email || profile.username || profile.id).slice(0, 200),
          groups: groups.filter(group => Number.isSafeInteger(group?.id) && group.id > 0)
            .map(group => ({ id: group.id, name: String(group.name || group.id).slice(0, 120) })),
        },
      }
    })
  } catch (error) {
    const known = ['loginRequired', 'accountChanged', 'groupUnavailable', 'issuerUnavailable']
    return { error: error instanceof Error && known.includes(error.message) ? error.message : 'consoleUnavailable' }
  }
}

async function consoleTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: SITE + '/*' })
  return tabs.find(tab => !tab.incognito && tab.id !== undefined && tab.url?.startsWith(SITE + '/') &&
    (!tab.pendingUrl || tab.pendingUrl.startsWith(SITE + '/')))
}

export async function openConsole(): Promise<void> {
  const tab = await consoleTab()
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true, url: CONSOLE })
    await chrome.windows.update(tab.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url: CONSOLE })
  }
}

async function run(operation: Operation): Promise<Result> {
  const tab = await consoleTab()
  if (tab?.id === undefined) throw new FoxmindError('consoleTabRequired')
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] },
    func: inFoxmoriTab,
    args: [operation],
  }).catch(() => { throw new FoxmindError('consoleUnavailable') })
  const result = injection?.result
  if (!result) throw new FoxmindError('consoleUnavailable')
  if ('error' in result) throw new FoxmindError(result.error)
  return result
}

export async function readAccount(): Promise<Account> {
  const result = await run({ type: 'account' })
  if (!('account' in result)) throw new FoxmindError('consoleUnavailable')
  const { id, label } = result.account
  await chrome.storage.local.set({ [accountKey]: { id, label } })
  return result.account
}

export async function issueKey(accountId: number, groupId: number): Promise<string> {
  const result = await run({ type: 'key', accountId, groupId })
  if (!('key' in result)) throw new FoxmindError('issuerUnavailable')
  return result.key
}
