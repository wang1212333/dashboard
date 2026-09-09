/** Workbench-only visual adapter. It lives in a ShadowRoot, never in the DSH shell. */
export const nativeWorkbenchTheme = `
:host{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.65;color:#202020;color-scheme:light}
.native-content{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;--dsh-chat-content-width:100%;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#555;--dsw-alias-label-tertiary:#737373;--dsw-alias-label-caption:#858585;--dsw-alias-bg-base:#fff;--dsw-specific-bubble:#f4f4f4}
.native-content>div{height:100%;min-height:0}
.native-content,.native-content button,.native-content input,.native-content textarea{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}
.native-content [class$="_column"]{width:100%;max-width:none;padding:16px 20px 12px;box-sizing:border-box}
.native-content [class$="_scroll"]{padding:0}
.native-content [class$="_flowItem"]{margin-bottom:14px}
.native-content p,.native-content li,.native-content table{font-size:14px;line-height:1.65;color:#202020}
.native-content p{margin:0 0 14px}
.native-content ul,.native-content ol{margin:6px 0 14px;padding-left:22px}
.native-content li{margin:2px 0}
.native-content li>p{margin:0}
.native-content h1{font-size:20px;line-height:1.4;margin:20px 0 12px}
.native-content h2{font-size:17px;line-height:1.45;margin:18px 0 10px}
.native-content h3{font-size:15px;line-height:1.5;margin:16px 0 8px}
.native-content [class$="_bubble"]{font-size:14px;line-height:1.6;padding:12px 16px;border-radius:14px;background:#f4f4f4;color:#171717;font-weight:600}
.native-content [class$="_userStack"]{max-width:82%}
.native-content [class$="_turnStatus"]{font-size:12px;line-height:20px;color:#858585;-webkit-text-fill-color:#858585;background:none;animation:none}
.native-content [class$="_turnStatusTime"]{color:#858585;-webkit-text-fill-color:#858585}
.native-content [class$="_toBottomSlot"]{justify-content:center;padding-right:0;bottom:12px}
.native-content [class$="_toBottom"]{width:36px;height:32px;border:0;border-radius:8px;background:transparent;box-shadow:none;color:#292929}
.native-content [class$="_toBottom"]:hover{background:#f5f5f5}
.native-content [class$="_toBottom"] svg{width:28px;height:28px;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.native-content pre{max-width:100%;overflow:auto;font-size:12px;line-height:1.6}
.native-content button:focus-visible{outline:2px solid #555;outline-offset:2px}
@media(max-width:760px){.native-content [class$="_column"]{padding-inline:12px}.native-content [class$="_userStack"]{max-width:90%}}
`

/** New native render target in the SAME document as workbench menus. Styles are
 * isolated, and existing native nodes / event handlers are never copied. */
export function createNativeSurfacePanel(source: Document, destination: Document) {
  const panel = destination.createElement('div')
  panel.dataset.nativeConversationSurface = ''
  const shadow = panel.attachShadow({ mode: 'open' })
  const styles = destination.createElement('div')
  const content = destination.createElement('div')
  content.className = 'native-content'
  const theme = destination.createElement('style')
  theme.textContent = nativeWorkbenchTheme
  shadow.append(styles, theme, content)
  const imported = new Map<Element, Element>()
  const syncStyles = () => {
    const current = Array.from(source.head.querySelectorAll('style,link[rel="stylesheet"]'))
    for (const [original, copy] of imported) if (!current.includes(original)) { copy.remove(); imported.delete(original) }
    for (const original of current) {
      let copy = imported.get(original)
      if (!copy) {
        copy = destination.createElement(original.tagName.toLowerCase())
        if (original.tagName === 'LINK') {
          copy.setAttribute('rel', 'stylesheet')
          copy.setAttribute('href', new URL(original.getAttribute('href')!, source.baseURI).href)
        }
        styles.append(copy); imported.set(original, copy)
      }
      if (original.tagName === 'STYLE' && copy.textContent !== original.textContent) copy.textContent = original.textContent
    }
    const tokens = source.defaultView!.getComputedStyle(source.documentElement)
    for (const name of Array.from(tokens)) if (name.startsWith('--')) panel.style.setProperty(name, tokens.getPropertyValue(name))
  }
  syncStyles()
  const observer = new MutationObserver(syncStyles)
  observer.observe(source.head, { childList: true, subtree: true, characterData: true })
  destination.body.append(panel)
  return { panel, content, dispose() { observer.disconnect(); panel.remove() } }
}
