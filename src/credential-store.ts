import { FoxmindError, getSettings, type Credential, type Settings } from './shared.ts'

export type CredentialSnapshot = Pick<Settings, 'credential' | 'credentialRevision'>

export function sameCredentialVersion(current: CredentialSnapshot, expected: CredentialSnapshot): boolean {
  return current.credentialRevision === expected.credentialRevision &&
    current.credential?.key === expected.credential?.key && current.credential?.label === expected.credential?.label
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
  return await updateCredentialSettings(expected, current => ({
    credential,
    credentialRevision: crypto.randomUUID(),
    model: credential && current.credential?.key === credential.key ? current.model : '',
  }))
}

export function saveSelectedModel(model: string, expected: CredentialSnapshot): Promise<Settings> {
  return updateCredentialSettings(expected, () => ({ model }))
}

export function applyAvailableModels(models: string[], expected: CredentialSnapshot): Promise<Settings> {
  return updateCredentialSettings(expected, current => ({
    model: models.includes(current.model) ? current.model : models.length === 1 ? models[0] : '',
  }))
}
