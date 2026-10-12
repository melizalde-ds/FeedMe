async (page) => {
  // Motion, with the system asking for it and with it asking for less.
  // Signed in, with a plan whose first week is confirmed.
  const BASE = 'http://localhost:5173'
  const log = []
  const errors = []
  const onPageError = (e) => errors.push(`pageerror ${e.message}`)
  page.on('pageerror', onPageError)
  const step = async (name, fn) => {
    try { const d = await fn(); log.push(`PASS ${name}${d ? ' — ' + d : ''}`) } catch (e) { log.push(`FAIL ${name} — ${String(e.message).split('\n')[0]}`) }
  }
  const tile = (label) => page.getByRole('button', { name: new RegExp(`^(Choose a meal for )?${label}`) })
  const css = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop)
  const scaleOf = async (locator) => {
    const t = await css(locator, 'transform')
    return t === 'none' ? 1 : Number(t.match(/matrix\(([^,]+)/)[1])
  }
  const openPlan = async () => {
    await page.goto(BASE + '/')
    await page.getByRole('heading', { name: 'Your household' }).waitFor()
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Plan' }).click()
    await page.getByRole('heading', { name: 'Your meal plan' }).waitFor()
    await page.waitForLoadState('networkidle')
  }

  for (const mode of ['no-preference', 'reduce']) {
    const calm = mode === 'reduce'
    const tag = calm ? 'reduced motion' : 'full motion'
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: mode })
    await openPlan()
    const target = tile('Lunch on Wednesday')
    const other = tile('Lunch on Monday')

    await step(`${tag}: a meal at rest ${calm ? 'already shows its details' : 'keeps its details tucked away'}`, async () => {
      const shown = Number(await css(target.locator('.tile__more'), 'opacity'))
      const tucked = (await css(target.locator('.tile__body'), 'transform')) !== 'none'
      if (calm ? (shown < 0.9 || tucked) : (shown > 0.1 || !tucked)) throw new Error(`details ${shown}, tucked ${tucked}`)
      return `details at ${shown} opacity`
    })
    await step(`${tag}: pointing at a meal ${calm ? 'rings it without growing it' : 'grows it by 5%'}, shows its details and dims the rest`, async () => {
      await target.hover()
      await page.waitForTimeout(450)
      const scale = await scaleOf(target)
      const dim = Number(await css(other, 'opacity'))
      const more = Number(await css(target.locator('.tile__more'), 'opacity'))
      const ring = await css(target, 'boxShadow')
      await page.mouse.move(4, 4)
      if (calm ? scale !== 1 : Math.abs(scale - 1.05) > 0.005) throw new Error(`scale ${scale}`)
      if (dim > 0.6 || more < 0.9 || !ring.includes('198, 242, 74')) throw new Error(`dim ${dim}, details ${more}, ring ${ring.slice(0, 40)}`)
      return `scale ${scale}, others at ${dim}`
    })
    await step(`${tag}: the recipe shelf ${calm ? 'fades in' : 'unfolds'}`, async () => {
      await target.click()
      const shelf = page.locator('section.unfold')
      await shelf.waitFor()
      const name = await css(shelf, 'animationName')
      await page.waitForTimeout(400)
      const settled = await css(shelf, 'opacity')
      await page.keyboard.press('Escape')
      if (name !== (calm ? 'fade-in' : 'unfold') || settled !== '1') throw new Error(`animation ${name}, opacity ${settled}`)
      return name
    })
    await step(`${tag}: a dialog ${calm ? 'fades in' : 'rises in'}, and its backdrop fades`, async () => {
      await page.getByRole('button', { name: 'Add your own recipe' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      const name = await css(dialog, 'animationName')
      await page.keyboard.press('Escape')
      if (name !== (calm ? 'fade-in' : 'sheet-in')) throw new Error(name)
      return name
    })
    await step(`${tag}: confirming the week ${calm ? 'shows its tick at once' : 'draws its tick'}`, async () => {
      const button = page.getByRole('button', { name: /onfirm this week/ })
      await button.click()
      const path = page.locator('.draw path')
      await path.waitFor()
      const name = await css(path, 'animationName')
      await page.waitForTimeout(700)
      const offset = await css(path, 'strokeDashoffset')
      if (name !== (calm ? 'none' : 'draw') || offset !== '0px') throw new Error(`animation ${name}, offset ${offset}`)
      return name
    })
    await step(`${tag}: a note eases in with a fade${calm ? ' only' : ' and a 4px drop'}`, async () => {
      const note = page.getByRole('status').filter({ hasText: 'What changed' })
      await note.waitFor()
      const transition = await css(note, 'transitionProperty')
      if (!transition.includes('opacity')) throw new Error(transition)
      return transition
    })
  }

  await step('phone: nothing is tucked or scaled, and a tap leaves no stuck hover', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 390, height: 844 })
    await openPlan()
    const target = tile('Lunch on Monday')
    const more = Number(await css(target.locator('.tile__more'), 'opacity'))
    const tucked = (await css(target.locator('.tile__body'), 'transform')) !== 'none'
    if (more < 0.9 || tucked) throw new Error(`details ${more}, tucked ${tucked}`)
  })

  await page.emulateMedia({ reducedMotion: null })
  await page.setViewportSize({ width: 1440, height: 900 })
  page.off('pageerror', onPageError)
  return { log, errors }
}
