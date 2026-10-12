async (page) => {
  const OUT = '/home/fedora/GitHub/FeedMe/.redesign/__PHASE__/'
  const BASE = 'http://localhost:5173'
  const log = []
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`${page.url()} :: pageerror ${e.message}`))

  const shot = async (name) => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(150)
      await page.screenshot({ path: `${OUT}${name}-${w}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const check = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)

  await page.context().clearCookies()
  await page.goto(BASE + '/')
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '/')
  await page.waitForURL('**/login')
  check('signed-out / redirects to /login', page.url().endsWith('/login'))
  await shot('login-empty')

  // unknown route goes home, then to /login
  await page.goto(BASE + '/nope')
  await page.waitForURL('**/login')
  check('unknown route redirects', page.url().endsWith('/login'))

  // validation
  await page.getByRole('button', { name: 'Sign in' }).click()
  const emailErr = await page.locator('#auth-email-error').textContent()
  const passErr = await page.locator('#auth-password-error').textContent()
  check('login: empty submit shows field errors', Boolean(emailErr && passErr), `${emailErr} | ${passErr}`)
  check('login: aria-invalid set', (await page.locator('#auth-email').getAttribute('aria-invalid')) === 'true')
  await shot('login-validation')

  // wrong credentials
  await page.locator('#auth-email').fill('nobody@example.com')
  await page.locator('#auth-password').fill('wrong-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const alert = page.getByRole('alert')
  await alert.first().waitFor()
  check('login: wrong credentials shows an alert', true, await alert.first().textContent())
  await shot('login-error')

  // link to register
  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.waitForURL('**/register')
  check('login → register link', true)
  await shot('register-empty')

  await page.locator('#auth-email').fill('not-an-email')
  await page.locator('#auth-password').fill('short')
  await page.getByRole('button', { name: 'Create account' }).click()
  check('register: bad email + short password errors',
    Boolean(await page.locator('#auth-email-error').count()) && Boolean(await page.locator('#auth-password-error').count()),
    `${await page.locator('#auth-email-error').textContent()} | ${await page.locator('#auth-password-error').textContent()}`)
  await shot('register-validation')

  // keyboard: tab order through the form
  await page.goto(BASE + '/register')
  const order = []
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab')
    order.push(await page.evaluate(() => {
      const el = document.activeElement
      return el ? (el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName) : 'none'
    }))
  }
  log.push('INFO register tab order: ' + order.join(' → '))

  // theme toggle cycles system → light → dark
  const toggle = page.getByRole('button', { name: /^Theme:/ })
  const themes = []
  for (let i = 0; i < 3; i += 1) {
    await toggle.click()
    themes.push(await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'system'))
  }
  check('theme toggle cycles light/dark/system', themes.join(',') === 'light,dark,system', themes.join(','))

  // register for real
  const email = globalThis.__email || `baseline-${Date.now()}@example.com`
  await page.locator('#auth-email').fill(email)
  await page.locator('#auth-password').fill('redesign-local-only-1')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL(BASE + '/', { timeout: 15000 })
  await page.getByRole('heading', { name: 'Your household' }).waitFor()
  check('register: creates the account and lands on Setup', true, email)

  // sign out, sign back in
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('**/login')
  check('sign out returns to /login', true)
  await page.locator('#auth-email').fill(email)
  await page.locator('#auth-password').fill('redesign-local-only-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(BASE + '/', { timeout: 15000 })
  await page.getByRole('heading', { name: 'Your household' }).waitFor()
  check('sign in lands on Setup', true)

  // signed-in user is bounced away from /login
  await page.goto(BASE + '/login')
  await page.waitForURL(BASE + '/')
  check('signed-in /login redirects to /', true)

  return { email, log, errors }
}
