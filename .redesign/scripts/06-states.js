async (page) => {
  const OUT = '/home/fedora/GitHub/FeedMe/.redesign/__PHASE__/'
  const BASE = 'http://localhost:5173'
  const SHOP = __SHOPPING__
  const log = []
  const errors = []
  const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text()) }
  const onPageError = (e) => errors.push(`pageerror ${e.message}`)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  const shot = async (name) => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(150)
      await page.screenshot({ path: `${OUT}${name}-${w}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const step = async (name, fn) => {
    try { const detail = await fn(); log.push(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
    catch (e) { log.push(`FAIL ${name} — ${String(e.message).split('\n')[0]}`) }
  }
  const text = (locator) => locator.first().textContent({ timeout: 6000 }).then((t) => t.replace(/\s+/g, ' ').trim())
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const saveBar = () => page.getByRole('button', { name: 'Save to my account' }).locator('xpath=..').locator('p')

  // Error answers from the server, played back. Signed in, on Setup.
  await page.unrouteAll()
  const order = { id: SHOP.orderId, grocery_list_id: SHOP.listId, mode: 'manual', status: 'placed', summary: SHOP.summary, finish_reason: 'completed' }
  await page.route('**/api/orders/*', (route) => route.fulfill(json(order)))
  await page.route('**/api/grocery-lists/*/cart', (route) => route.fulfill(json(SHOP.cartAfter)))
  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Your household' }).waitFor()
  await page.waitForTimeout(600)

  const putOnly = (answer) => (route) =>
    route.request().method() === 'PUT' ? route.fulfill(answer) : route.fallback()

  await step('save: server unreachable (503) is reported in the save bar', async () => {
    await page.route('**/api/preferences', putOnly(json({ detail: 'down' }, 503)))
    await page.getByRole('button', { name: 'Save to my account' }).click()
    await page.waitForTimeout(1500)
    const t = await text(saveBar())
    await shot('setup-save-unavailable')
    return t
  })
  await step('plan: generating while the setup can not be saved explains why there is no plan', async () => {
    await page.getByRole('button', { name: /Generate meal plan|Rebuild my plan/ }).click()
    return text(page.getByRole('alert').filter({ hasText: 'We could not build that plan' }))
  })
  await step('save: a refusal from the server (400) shows its message as an alert', async () => {
    await page.unroute('**/api/preferences')
    await page.route('**/api/preferences', putOnly(json({ detail: 'The weekly budget must be zero or more.' }, 400)))
    await page.getByRole('button', { name: 'Save to my account' }).click()
    await page.waitForTimeout(1500)
    const t = await text(saveBar())
    if ((await saveBar().first().getAttribute('role')) !== 'alert') throw new Error('not an alert: ' + t)
    await page.unroute('**/api/preferences')
    return t
  })
  await step('plan: "no recipe fits" (422) is explained', async () => {
    await page.route('**/api/meal-options', (route) => route.fulfill(json({ detail: 'nothing fits' }, 422)))
    await page.getByRole('button', { name: /Generate meal plan|Rebuild my plan/ }).click()
    const banner = page.getByRole('alert').filter({ hasText: 'No recipe fits' })
    const t = await text(banner)
    await page.unroute('**/api/meal-options')
    return t
  })
  await step('plan: an answer the app can not read is refused, not shown', async () => {
    await page.route('**/api/meal-options', (route) => route.fulfill(json({ nonsense: true })))
    await page.getByRole('button', { name: /Generate meal plan|Rebuild my plan/ }).click()
    const t = await text(page.getByRole('alert').filter({ hasText: 'could not read' }))
    await page.unroute('**/api/meal-options')
    return t
  })
  await step('load: with the account unreachable, Setup still opens from this browser’s copy', async () => {
    for (const path of ['allergies', 'preferences', 'nutrition-goals']) {
      await page.route(`**/api/${path}`, (route) => route.fulfill(json({ detail: 'down' }, 503)))
    }
    await page.reload()
    await page.getByRole('heading', { name: 'Your household' }).waitFor()
    await page.waitForTimeout(1200)
    const hint = await page.getByText('Loading the allergies already on your account…').count()
    const bar = await text(saveBar())
    await shot('setup-account-unreachable')
    return `allergies hint ${hint ? 'shown' : 'not shown'} | ${bar}`
  })

  await page.unrouteAll()
  page.off('console', onConsole)
  page.off('pageerror', onPageError)
  return { log, errors }
}
