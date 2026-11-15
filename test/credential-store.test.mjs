import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAvailableModels, saveCredentialConfig, saveCustomAIConfig, saveSelectedModel, saveSummaryPermission, switchAIProvider,
} from '../src/credential-store.ts'
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

test('switching providers preserves Foxmori credentials and invalidates pending Foxmori requests', async () => {
  const pending = await getSettings()
  const switched = await switchAIProvider('custom', pending)
  assert.equal(switched.allowCloud, false)
  const custom = await saveCustomAIConfig({ baseUrl: 'https://custom.example/v1', key: 'custom-key', model: 'custom-model' }, switched)
  await assert.rejects(saveCredentialConfig({ key: 'issued-key' }, pending), changed)
  await assert.rejects(applyAvailableModels(['obsolete-model'], pending), changed)
  assert.equal(custom.credential.key, 'original-key')
  assert.equal(custom.model, 'original-model')
  const restored = await switchAIProvider('foxmori', custom)
  assert.equal(restored.credential.key, 'original-key')
  assert.equal(restored.customAI.model, 'custom-model')
})

test('changing the custom endpoint with the same key invalidates older configuration writes and resets consent', async () => {
  const custom = await switchAIProvider('custom', await getSettings())
  const previous = await saveCustomAIConfig({ baseUrl: 'https://old.example/v1', key: 'same-key', model: 'model' }, custom)
  saved.allowCloud = true
  const next = await saveCustomAIConfig({ baseUrl: 'http://localhost:1234/v1', key: 'same-key', model: 'model' }, previous)
  await assert.rejects(saveCustomAIConfig(previous.customAI, previous), changed)
  assert.equal(next.allowCloud, false)
  assert.equal(next.customAI.baseUrl, 'http://localhost:1234/v1')
})

test('a local service can save and remove a configuration without an API key', async () => {
  const custom = await switchAIProvider('custom', await getSettings())
  const local = await saveCustomAIConfig({ baseUrl: 'http://127.0.0.1:1234', key: '', model: ' local-model ' }, custom)
  assert.deepEqual(local.customAI, { baseUrl: 'http://127.0.0.1:1234/v1', key: '', model: 'local-model' })
  const removed = await saveCustomAIConfig(null, local)
  assert.equal(removed.customAI, null)
  assert.equal(removed.credential.key, 'original-key')
})

test('consent from an older settings tab cannot authorize a different AI service', async () => {
  const foxmori = await getSettings()
  const custom = await switchAIProvider('custom', foxmori)
  await assert.rejects(saveSummaryPermission(true, foxmori), changed)
  const previous = await saveCustomAIConfig({ baseUrl: 'https://old.example/v1', key: 'key', model: 'model' }, custom)
  await saveSummaryPermission(true, previous)
  const next = await saveCustomAIConfig({ ...previous.customAI, baseUrl: 'https://new.example/v1' }, previous)
  await assert.rejects(saveSummaryPermission(true, previous), changed)
  assert.equal((await getSettings()).allowCloud, false)
  await saveSummaryPermission(true, next)
  assert.equal((await getSettings()).allowCloud, true)
})
