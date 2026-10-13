/**
 * Auto-height for the 雀CUBE availability iframe. The widget may send
 * `{ type: 'jancube:resize', height: <px> }` with window.parent.postMessage; messages from any
 * other origin are ignored.
 */
;(() => {
  const settings = window.jancubeAvailability || {}
  if (!settings.origin) return
  window.addEventListener('message', (event) => {
    if (event.origin !== settings.origin) return
    const data = event.data
    if (data?.type !== 'jancube:resize') return
    const height = Number(data.height)
    if (!Number.isFinite(height) || height < 100 || height > 4000) return
    for (const frame of document.querySelectorAll('iframe.jancube-availability')) {
      if (frame.contentWindow === event.source) frame.style.height = `${Math.ceil(height)}px`
    }
  })
})()
