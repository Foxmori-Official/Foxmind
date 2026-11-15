export type ExportFormat = 'html' | 'markdown'

// Invoked by chrome.scripting in the page's isolated world.
export function captureExport(format: ExportFormat) {
  const url = location.href
  const title = document.title.trim().slice(0, 300)
  const html = format === 'html'
  const source = html ? document.documentElement
    : document.querySelector('main, [role="main"]') ?? document.querySelector('article') ?? document.body
  if (!source || !document.head) return

  const copy = source.cloneNode(true) as Element
  if (!html) {
    const originals = source.querySelectorAll('*')
    const clones = copy.querySelectorAll('*')
    for (const [index, node] of clones.entries()) {
      if (!copy.contains(node)) continue
      const style = getComputedStyle(originals[index])
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) node.remove()
    }
    copy.querySelectorAll('nav, [role="navigation"], svg, style').forEach(element => element.remove())
  }
  copy.querySelectorAll([
    'script', 'noscript', 'template', 'base', 'meta[http-equiv]', 'meta[charset]', 'meta[name="referrer" i]',
    'link:not([rel~="stylesheet" i])', 'iframe', 'frame', 'object', 'embed', 'portal', 'fencedframe',
    'form', 'input', 'textarea', 'select', 'button',
  ].join(',')).forEach(element => element.remove())

  const base = new URL(document.baseURI, url)
  const safeBase = /^https?:$/.test(base.protocol) && !base.username && !base.password ? base : new URL(url)
  safeBase.username = safeBase.password = ''
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    for (const { name, value } of [...element.attributes]) {
      if (name.startsWith('on') || ['ping', 'autoplay', 'srcdoc'].includes(name)) {
        element.removeAttribute(name)
      } else if (['href', 'xlink:href', 'src', 'poster', 'background'].includes(name)) {
        try {
          const link = new URL(value, safeBase)
          const allowed = /^https?:$/.test(link.protocol) ||
            (name === 'href' && /^(mailto|tel):$/.test(link.protocol)) ||
            (element.localName === 'img' && name === 'src' && /^data:image\//i.test(value))
          if (!allowed || link.username || link.password) element.removeAttribute(name)
          else if (!html) element.setAttribute(name, link.href)
        } catch { element.removeAttribute(name) }
      }
    }
  }

  if (!html) return { url, title, content: copy.innerHTML }

  const head = copy.querySelector('head')
  if (!head) return
  const charset = document.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const csp = document.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = "default-src 'none'; style-src 'unsafe-inline' http: https:; img-src http: https: data:; " +
    "font-src http: https: data:; media-src http: https: data:; base-uri http: https:; form-action 'none'"
  const referrer = document.createElement('meta')
  referrer.name = 'referrer'
  referrer.content = 'no-referrer'
  const baseElement = document.createElement('base')
  baseElement.href = safeBase.href
  head.prepend(charset, csp, referrer, baseElement)
  return { url, title, content: '<!doctype html>\n' + copy.outerHTML }
}
