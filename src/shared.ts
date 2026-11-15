export const SITE = 'https://foxmori.com'
export const API = 'https://api.foxmori.com/v1'
export const CONSOLE = SITE + '/#models'

export type Language = 'auto' | 'zh' | 'en'

export interface Credential {
  key: string
  label?: string
}

export type AIProvider = 'foxmori' | 'custom'

export interface AIService {
  baseUrl: string
  key: string
  model: string
}

export interface Settings {
  provider: AIProvider
  customAI: AIService | null
  credential: Credential | null
  credentialRevision: string
  model: string
  language: Language
  uiLocale: 'auto' | 'en' | 'zh-CN'
  allowCloud: boolean
  foxdownUrl: string
  foxdownToken: string
  onboardingCompleted: boolean
}

const defaults: Settings = {
  provider: 'foxmori',
  customAI: null,
  credential: null,
  credentialRevision: '',
  model: '',
  language: 'auto',
  uiLocale: 'auto',
  allowCloud: false,
  foxdownUrl: '',
  foxdownToken: '',
  onboardingCompleted: false,
}

export async function getSettings(): Promise<Settings> {
  return await chrome.storage.local.get(defaults) as Settings
}

export function actionKey(windowId: number): string {
  return 'foxmind-action-' + windowId
}

export interface PageAction {
  id: string
  tabId: number
  url: string
  at: number
}

export interface DirectResource {
  url: string
  name: string
  type: string
  size?: number
  headers?: Record<string, string>
  source?: 'dom' | 'network'
}

export interface Paragraph {
  text: string
  heading?: boolean
}

export interface PageSnapshot {
  url: string
  title: string
  paragraphs: Paragraph[]
  limited: boolean
}

export interface PageIdentity {
  tabId: number
  documentId: string
  pageUrl: string
}

export function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export class FoxmindError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}
