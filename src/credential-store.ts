import { FoxmindError, getSettings, type AIProvider, type AIService, type Credential, type Settings } from './shared.ts'
import { validateCustomAI } from './ai-service.ts'

export type CredentialSnapshot = Pick<Settings, 'credential' | 'credentialRevision' | 'provider' | 'customAI'>

export function sameCredentialVersion(current: CredentialSnapshot, expected: CredentialSnapshot): boolean {
  return current.credentialRevision === expected.credentialRevision &&
    current.provider === expected.provider &&
    current.credential?.key === expected.credential?.key && current.credential?.label === expected.credential?.label &&
    current.customAI?.baseUrl === expected.customAI?.baseUrl && current.customAI?.key === expected.customAI?.key
}

async function updateCredentialSettings(
  expected: CredentialSnapshot | undefined, change: (current: Settings) => Partial<Settings>,
): Promise<Settings> {
  // Every settings tab shares this lock. Model requests run outside it.
  return await navigator.locks.request('foxmind-credential-settings', async () => {
    const current = await getSettings()
    if (expected && !sameCredentialVersion(current, expected)) throw new FoxmindError('credentialChanged')
    const patch = change(current)
    await chrome.storage.local.set(patch)
    return { ...current, ...patch }
  })
}

export async function saveCredentialConfig(credential: Credential | null, expected?: CredentialSnapshot): Promise<Settings> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  return await updateCredentialSettings(expected, current => {
    if (current.provider !== 'foxmori') throw new FoxmindError('credentialChanged')
    return {
      credential,
      credentialRevision: crypto.randomUUID(),
      model: credential && current.credential?.key === credential.key ? current.model : '',
    }
  })
}

export function saveSelectedModel(model: string, expected: CredentialSnapshot): Promise<Settings> {
  return updateCredentialSettings(expected, current => {
    if (current.provider !== 'foxmori') throw new FoxmindError('credentialChanged')
    return { model }
  })
}

export function saveSummaryPermission(allowCloud: boolean, expected: CredentialSnapshot): Promise<Settings> {
  return updateCredentialSettings(expected, () => ({ allowCloud }))
}

export function applyAvailableModels(models: string[], expected: CredentialSnapshot): Promise<Settings> {
  return updateCredentialSettings(expected, current => {
    if (current.provider !== 'foxmori') throw new FoxmindError('credentialChanged')
    return { model: models.includes(current.model) ? current.model : models.length === 1 ? models[0] : '' }
  })
}

export function switchAIProvider(provider: AIProvider, expected: CredentialSnapshot): Promise<Settings> {
  return updateCredentialSettings(expected, current => {
    if (provider !== 'foxmori' && provider !== 'custom') throw new FoxmindError('invalidAIProvider')
    if (current.provider === provider) return {}
    return { provider, allowCloud: false, credentialRevision: crypto.randomUUID() }
  })
}

export function saveCustomAIConfig(service: AIService | null, expected: CredentialSnapshot): Promise<Settings> {
  const customAI = service ? validateCustomAI(service) : null
  return updateCredentialSettings(expected, current => {
    if (current.provider !== 'custom') throw new FoxmindError('credentialChanged')
    return {
      customAI,
      allowCloud: current.customAI?.baseUrl === customAI?.baseUrl && current.allowCloud,
      credentialRevision: crypto.randomUUID(),
    }
  })
}
