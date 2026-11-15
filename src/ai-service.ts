import { API, FoxmindError, type AIService, type Settings } from './shared.ts'

export function normalizeAIBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new FoxmindError('invalidAIUrl') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new FoxmindError('invalidAIUrl')
  }
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/(?:chat\/completions|models)$/, '')
  url.pathname = path || '/v1'
  return url.href.replace(/\/+$/, '')
}

export function aiPermission(baseUrl: string): string {
  return new URL(normalizeAIBaseUrl(baseUrl)).origin + '/*'
}

export function getAIService(settings: Pick<Settings, 'provider' | 'customAI' | 'credential' | 'model'>): AIService | undefined {
  if (settings.provider === 'custom') return settings.customAI ?? undefined
  if (!settings.credential) return
  return { baseUrl: API, key: settings.credential.key, model: settings.model }
}

export function validateCustomAI(service: AIService): AIService {
  const baseUrl = normalizeAIBaseUrl(service.baseUrl)
  const key = service.key.trim()
  const model = service.model.trim()
  if (key && !/^[^\s•*]{1,512}$/.test(key)) throw new FoxmindError('invalidKey')
  if (model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) throw new FoxmindError('invalidModel')
  return { baseUrl, key, model }
}
