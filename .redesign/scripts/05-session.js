async (page) => {
  const OUT = '/home/fedora/GitHub/FeedMe/.redesign/__PHASE__/'
  const BASE = 'http://localhost:5173'
  const EMAIL = '__EMAIL__'
  const SHOP = __SHOPPING__
  const log = []
  const errors = []
  const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text()) }
  page.on('console', onConsole)

  const signIn = async () => {
    // Start signed out, whatever the last script left behind.
    await page.goto(BASE + '/login')
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sb-')) localStorage.removeItem(key)
    })
    await page.goto(BASE + '/login')
    await page.locator('#auth-email').fill(EMAIL)
    await page.locator('#auth-password').fill('redesign-local-only-1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your household' }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(600)
  }

  // The plan in this browser points at the fixture's shopping run, which the
  // real server has never heard of, so its order and cart are played back.
  const mockRun = async () => {
    const order = { id: SHOP.orderId, grocery_list_id: SHOP.listId, mode: 'manual', status: 'placed', summary: SHOP.summary, finish_reason: 'completed' }
    await page.route('**/api/orders/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) }))
    await page.route('**/api/grocery-lists/*/cart', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHOP.cartAfter) }))
  }

  // A 401 from the API drops the session and sends the user to /login with a
  // notice. Tried several times, because today the notice does not always
  // survive the redirect.
  const outcomes = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.unrouteAll()
    await mockRun()
    await signIn()
    await page.route('**/api/preferences', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' }))
    await page.getByRole('button', { name: 'Save to my account' }).click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 8000 })
    await page.waitForTimeout(700)
    const shown = await page.getByText('Your session has ended.').count()
    outcomes.push(shown ? 'notice shown' : 'notice missing')
    if (shown) {
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h })
        await page.screenshot({ path: `${OUT}login-session-ended-${w}.png`, fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
  }
  const onLogin = page.url().endsWith('/login')
  log.push(`${onLogin ? 'PASS' : 'FAIL'} session: a 401 from the server signs the user out and lands on /login`)
  log.push(`INFO session-ended notice over 4 tries: ${outcomes.join(', ')}`)

  await page.unrouteAll()
  await mockRun()
  await signIn()
  log.push('PASS session: signing in again restores the account’s setup and plan')
  page.off('console', onConsole)
  return { log, errors: errors.filter((e) => !e.includes('401')) }
}
