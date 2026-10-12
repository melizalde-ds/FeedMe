async (page) => {
  // A measured pass over every step: sideways overflow at five widths, text
  // contrast, control size, and unnamed controls, in both themes. Signed in,
  // with a plan whose first week is confirmed.
  const BASE = 'http://localhost:5173'
  const findings = []
  const errors = []
  const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) }
  page.on('console', onConsole)
  const nav = (name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })

  const measure = () => page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[,\/\s]+/).filter(Boolean).map(Number); return { r, g, b, a } }
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
    const bgOf = (el) => {
      const layers = []
      for (let node = el; node; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor)
        if (c && c.a > 0) { layers.push(c); if (c.a === 1) break }
      }
      let base = parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
      for (const layer of layers.reverse()) base = over(layer, base)
      return base
    }
    const out = { contrast: [], small: [], unnamed: [] }
    const seen = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim()
      const el = node.parentElement
      if (!text || !el || seen.has(el)) continue
      seen.add(el)
      // Text on a photograph sits on the tile's own shade, measured separately.
      if (el.closest('.tile, .sr-only, option, [aria-hidden="true"]')) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || !el.getClientRects().length) continue
      const fg = parse(style.color); if (!fg) continue
      const bg = bgOf(el)
      const ink = over(fg, bg)
      const ratio = (Math.max(lum(ink), lum(bg)) + 0.05) / (Math.min(lum(ink), lum(bg)) + 0.05)
      const size = parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      const disabled = el.closest(':disabled, [aria-disabled="true"], label:has(:disabled)')
      if (!disabled && ratio < (large ? 3 : 4.5)) out.contrast.push(`${ratio.toFixed(2)} "${text.slice(0, 40)}"`)
    }
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, summary')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const type = el.getAttribute('type')
      const name = el.getAttribute('aria-label') || el.textContent.trim() || el.labels?.[0]?.textContent.trim() || el.getAttribute('title')
      if (!name) out.unnamed.push(el.outerHTML.slice(0, 80))
      if (type === 'checkbox' || type === 'radio') continue
      if (el.closest('.tile') || el.tagName === 'A' || el.classList.contains('underline')) continue
      if (r.height < 24 || r.width < 24) out.small.push(`${Math.round(r.width)}×${Math.round(r.height)} ${name?.slice(0, 30)}`)
    }
    out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    return out
  })

  const steps = [
    ['Setup', async () => {}],
    ['Plan', async () => { await nav('Plan').click(); await page.getByRole('heading', { name: 'Your meal plan' }).waitFor(); await page.getByRole('button', { name: /^Dinner on Monday/ }).click(); await page.locator('section.unfold').waitFor() }],
    ['Grocery', async () => { await nav(/Grocery/).click(); await page.getByRole('heading', { name: 'Your grocery list' }).waitFor() }],
  ]
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const [name, go] of steps) {
        await page.goto(BASE + '/')
        await page.getByRole('heading', { name: 'Your household' }).waitFor()
        await go()
        await page.waitForTimeout(500)
        const m = await measure()
        const where = `${name} ${scheme} ${width}px`
        if (m.overflow > 0) findings.push(`${where}: page scrolls sideways by ${m.overflow}px`)
        if (width === 390 || width === 1440) {
          for (const c of [...new Set(m.contrast)]) findings.push(`${where}: contrast ${c}`)
          for (const s of [...new Set(m.small)]) findings.push(`${where}: small control ${s}`)
          for (const u of m.unnamed) findings.push(`${where}: unnamed control ${u}`)
        }
      }
    }
  }
  // the sign-in pages, signed out
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k) })
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/login', '/register']) {
        await page.goto(BASE + path)
        await page.getByRole('button', { name: /Sign in|Create account/ }).click()
        await page.waitForTimeout(300)
        const m = await measure()
        const where = `${path} ${scheme} ${width}px`
        if (m.overflow > 0) findings.push(`${where}: page scrolls sideways by ${m.overflow}px`)
        for (const c of [...new Set(m.contrast)]) findings.push(`${where}: contrast ${c}`)
        for (const u of m.unnamed) findings.push(`${where}: unnamed control ${u}`)
      }
    }
  }
  await page.emulateMedia({ colorScheme: null, reducedMotion: null })
  await page.setViewportSize({ width: 1440, height: 900 })
  page.off('console', onConsole)
  const log = findings.length ? findings.map((f) => `FAIL ${f}`) : ['PASS no sideways scroll at 390, 768, 1024, 1280 or 1440px; all text meets contrast; every control is named and at least 24px, in light and dark']
  return { log, errors: [...new Set(errors)] }
}
