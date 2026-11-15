import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAvailableModels, saveCredentialConfig, saveSelectedModel } from '../src/credential-store.ts'
import { getSettings } from '../src/shared.ts'

let saved
globalThis.chrome = {
  storage: {
    local: {
      get: async defaults => structuredClone({ ...defaults, ...saved }),
      set: async patch => { saved = { ...saved, ...structuredClone(patch) } },
      setAccessLevel: async () => {},
    },
  },
}

test.beforeEach(() => {
  saved = { credential: { key: 'original-key', label: 'Original account' }, model: 'original-model', allowCloud: true }
})

const changed = error => error.code === 'credentialChanged'

test('a delayed issuance cannot overwrite a manually saved key or its model', async () => {
  const pending = await getSettings()
  const manual = await saveCredentialConfig({ key: 'manual-key' })
  await saveSelectedModel('manual-model', manual)
  await assert.rejects(saveCredentialConfig({ key: 'issued-key' }, pending), changed)
  const current = await getSettings()
  assert.equal(current.credential.key, 'manual-key')
  assert.equal(current.model, 'manual-model')
  assert.equal(current.allowCloud, true)
})

test('removing a key invalidates an issuance that is still pending', async () => {
  const pending = await getSettings()
  const removed = await saveCredentialConfig(null)
  await assert.rejects(saveCredentialConfig({ key: 'issued-key' }, pending), changed)
  assert.equal((await getSettings()).credential, null)
  assert.equal((await getSettings()).model, '')
  assert.equal((await getSettings()).credentialRevision, removed.credentialRevision)
})

test('saving the same key again invalidates pending writes from its earlier revision', async () => {
  const pending = await getSettings()
  await saveCredentialConfig(pending.credential)
  await assert.rejects(saveCredentialConfig({ key: 'issued-key' }, pending), changed)
  await assert.rejects(applyAvailableModels(['obsolete-model'], pending), changed)
  assert.equal((await getSettings()).model, 'original-model')
})

test('removing and restoring a key cannot revive a stale issuance or model response', async () => {
  const pending = await getSettings()
  await saveCredentialConfig(null)
  const restored = await saveCredentialConfig(pending.credential)
  await saveSelectedModel('restored-model', restored)
  await assert.rejects(saveCredentialConfig({ key: 'issued-key' }, pending), changed)
  await assert.rejects(applyAvailableModels(['obsolete-model'], pending), changed)
  await assert.rejects(saveSelectedModel('obsolete-selection', pending), changed)
  assert.equal((await getSettings()).model, 'restored-model')
})

test('a model refresh preserves a newer valid model selection for the same key', async () => {
  const pending = await getSettings()
  await saveSelectedModel('new-selection', pending)
  await applyAvailableModels(['original-model', 'new-selection'], pending)
  assert.equal((await getSettings()).model, 'new-selection')
})

test('an issuance started with an unversioned saved configuration still succeeds', async () => {
  const pending = await getSettings()
  assert.equal(pending.credentialRevision, '')
  const issued = await saveCredentialConfig({ key: 'issued-key' }, pending)
  assert.ok(issued.credentialRevision)
  assert.equal(issued.model, '')
  await applyAvailableModels(['issued-model'], issued)
  assert.equal((await getSettings()).model, 'issued-model')
})
