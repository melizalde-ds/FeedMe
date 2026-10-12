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

  const shot = async (name, { full = true } = {}) => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(150)
      await page.screenshot({ path: `${OUT}${name}-${w}.png`, fullPage: full })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const check = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  const step = async (name, fn) => {
    try { const detail = await fn(); check(name, true, typeof detail === 'string' ? detail : '') }
    catch (e) { check(name, false, String(e.message).split('\n')[0]) }
  }
  const text = (locator) => locator.first().textContent({ timeout: 4000 }).then((t) => t.replace(/\s+/g, ' ').trim())
  const nav = (name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
  const buy = () => page.getByRole('region', { name: 'Have the buying agent shop for this' })
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

  // The buying agent's stream, played back inside the page: a run that waits
  // at the payment approval until window.__finishRun() is called.
  const installRun = () => page.evaluate((shop) => {
    const real = window.__realFetch ?? window.fetch.bind(window)
    window.__realFetch = real
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (!/\/shopping-runs$/.test(url) || init?.method !== 'POST') return real(input, init)
      window.__runBody = JSON.parse(init.body)
      const encoder = new TextEncoder()
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event) => controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          send({ type: 'run_created', order_id: shop.orderId, grocery_list_id: shop.listId })
          send({ type: 'run_started', mode: window.__runBody.mode, note: 'Two items on your list have no amount, so one pack of each is assumed.' })
          await wait(300)
          send({ type: 'tool_call', name: 'search_list', arguments: {} })
          await wait(300)
          send({ type: 'tool_call', name: 'add_to_cart', arguments: {} })
          send({ type: 'cart_updated', cart: shop.cart })
          send({ type: 'tool_call', name: 'checkout', arguments: {} })
          send({ type: 'approval_needed', stores: shop.approval.stores, total_cents: shop.approval.total_cents, approval_url: 'https://example.com/approve' })
          await new Promise((resolve) => { window.__finishRun = resolve })
          send({ type: 'tool_result', name: 'checkout' })
          send({ type: 'done', summary: shop.summary, finish_reason: 'completed' })
          controller.close()
        },
      })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
  }, SHOP)

  let order = { id: SHOP.orderId, grocery_list_id: SHOP.listId, mode: 'manual', status: 'placed', summary: SHOP.summary, finish_reason: 'completed' }
  let cart = SHOP.cartAfter
  const calls = []
  const installApi = async () => {
    await page.route('**/api/orders/*', (route) => route.fulfill(json(order)))
    await page.route('**/api/grocery-lists/*/cart', (route) => route.fulfill(json(cart)))
    await page.route('**/api/grocery-lists/*/cart/approve', (route) => {
      calls.push('approve')
      cart = { ...cart, items: cart.items.map((item) => ({ ...item, status: 'in_cart', hold_reasons: [] })) }
      return route.fulfill(json(cart))
    })
    await page.route('**/api/grocery-lists/*/cart/items/**', (route) => {
      const [store, upc] = route.request().url().split('/').slice(-2)
      calls.push(`remove ${store} ${upc}`)
      cart = { ...cart, items: cart.items.filter((item) => !(item.store === store && item.upc === upc)) }
      return route.fulfill({ status: 204 })
    })
  }

  await page.unrouteAll()
  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Your household' }).waitFor()

  await step('grocery: the list is built from the confirmed week', async () => {
    await nav('Grocery').click()
    await page.getByRole('heading', { name: 'Everything this plan needs' }).waitFor({ timeout: 3000 })
    const lede = await text(page.getByText(/Built from the \d+ meals? you confirmed/))
    const rows = await page.getByRole('table').first().locator('tbody tr').count()
    const beef = await text(page.getByRole('row', { name: /^Ground beef Sunday/ }))
    const dash = await page.getByRole('table').first().locator('tbody td', { hasText: /^—$/ }).count()
    if (!dash) throw new Error('no item without an amount')
    await page.getByText(/Items marked “—” come from planner recipes/).waitFor()
    return `${lede} | ${rows} items | own recipe row: ${beef} | ${dash} planner items with no amount`
  })
  await step('buy panel: names the own recipes it will not shop for, offers both modes', async () => {
    const own = await text(buy().getByText(/Not shopped for:/).locator('xpath=..'))
    const manual = buy().getByRole('radio', { name: /Let me check everything/ })
    const auto = buy().getByRole('radio', { name: /Buy it for me/ })
    if (!(await manual.isChecked()) || (await auto.isDisabled())) throw new Error('modes')
    await auto.check()
    await manual.check()
    return own
  })
  await shot('grocery-initial')

  await step('buy panel: without a budget "Buy it for me" is unavailable and says why', async () => {
    await nav('Setup').click()
    await page.locator('#budget').fill('0')
    await nav('Grocery').click()
    const auto = buy().getByRole('radio', { name: /Buy it for me/ })
    if (!(await auto.isDisabled())) throw new Error('still enabled')
    const label = await text(buy().locator('label').filter({ hasText: 'Buy it for me' }))
    await nav('Setup').click()
    await page.locator('#budget').fill('120')
    await nav('Grocery').click()
    return label
  })

  await step('run: starting asks first; "Not now" and Escape cancel', async () => {
    await buy().getByRole('button', { name: 'Shop for these groceries' }).click()
    const dialog = page.getByRole('dialog', { name: 'Shop for these groceries?' })
    await dialog.waitFor({ timeout: 2000 })
    const mode = await text(dialog.getByText(/Shopping mode:/))
    await shot('grocery-confirm-run', { full: false })
    await dialog.getByRole('button', { name: 'Not now' }).click()
    if (await page.getByRole('dialog').count()) throw new Error('still open')
    await buy().getByRole('button', { name: 'Shop for these groceries' }).click()
    await page.keyboard.press('Escape')
    if (await page.getByRole('dialog').count()) throw new Error('Escape did not close it')
    return mode
  })

  // A refusal from the server, played back. The real server is not asked: with
  // a working stack a run goes all the way to a payment request in the Link
  // app, and that is the owner's to trigger.
  await step('run: a run the server refuses says why, in a banner that can be dismissed', async () => {
    await page.route('**/api/shopping-runs', (route) =>
      route.fulfill(json({ detail: 'No recipe with id 3370, 8594, 10428' }, 404)))
    await buy().getByRole('button', { name: 'Shop for these groceries' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, shop for them' }).click()
    const banner = buy().getByRole('alert').filter({ hasText: 'The agent could not do that' })
    await banner.waitFor({ timeout: 10000 })
    const t = await text(banner)
    await shot('grocery-run-refused')
    await banner.getByRole('button', { name: 'Dismiss' }).click()
    if (await banner.count()) throw new Error('banner not dismissed')
    await page.unroute('**/api/shopping-runs')
    return t
  })

  await installApi()
  await installRun()
  await step('run: playback shows progress, the note, the cart and the payment approval', async () => {
    await buy().getByRole('radio', { name: /Buy it for me/ }).check()
    await buy().getByRole('button', { name: /^Shop for/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Shop for these groceries?' })
    await dialog.getByRole('checkbox', { name: 'Do this every time, without asking me first' }).check()
    await dialog.getByRole('button', { name: 'Yes, shop for them' }).click()
    const approval = buy().getByRole('status').filter({ hasText: 'Approve the payment' })
    await approval.waitFor({ timeout: 8000 })
    const body = await page.evaluate(() => window.__runBody)
    if (body.mode !== 'auto' || body.remember !== true) throw new Error(JSON.stringify(body))
    const status = await text(buy().getByRole('status').filter({ hasText: 'Waiting for the payment' }))
    if (!(await buy().getByRole('button', { name: 'Shopping…' }).isDisabled())) throw new Error('button not disabled')
    if (!(await buy().getByRole('radio', { name: /Buy it for me/ }).isDisabled())) throw new Error('modes not disabled')
    if (await buy().getByRole('button', { name: /^Remove/ }).count()) throw new Error('Remove offered during a run')
    const tables = await buy().getByRole('table').count()
    const link = await approval.getByRole('link', { name: 'Open the approval page' }).getAttribute('href')
    await shot('grocery-running')
    return `${status} | ${await text(approval)} | ${tables} store tables | link ${link} | sent ${JSON.stringify({ mode: body.mode, remember: body.remember, meals: body.meals?.length, budget_cents: body.budget_cents, household_size: body.household_size })}`
  })
  await step('run: it keeps going while the user visits another step', async () => {
    await nav('Plan').click()
    await page.getByRole('heading', { name: 'Your meal plan' }).waitFor({ timeout: 2000 })
    await nav('Grocery').click()
    await buy().getByRole('status').filter({ hasText: 'Approve the payment' }).waitFor({ timeout: 2000 })
  })
  await step('run: once paid it shows the orders per store, the reference, the saving, what was not found and what is left', async () => {
    await page.evaluate(() => window.__finishRun())
    await buy().getByRole('heading', { name: /^Paid: \$[\d.]+ in one payment/ }).waitFor({ timeout: 5000 })
    const paid = await text(buy().getByRole('heading', { name: /^Paid:/ }))
    const captions = await buy().locator('caption').allTextContents()
    const reference = await text(buy().getByText(/Stripe sandbox payment reference/))
    const saving = await text(buy().getByText(/Splitting the basket across stores saved/))
    const missing = await text(buy().getByText(/Not found in any store:/).locator('xpath=..'))
    await buy().getByRole('heading', { name: 'Still in the cart, not paid for' }).waitFor()
    const chips = await buy().getByText('Check this', { exact: true }).count()
    const reasons = await text(buy().getByText(/store brand, not the national one/))
    await buy().getByRole('button', { name: 'Shop for what is left' }).waitFor()
    await shot('grocery-paid')
    return `${paid} | ${captions.join(' / ')} | ${reference} | ${saving} | ${missing} | ${chips} marked "Check this" (${reasons})`
  })
  await step('run: "Do this every time" is remembered, and "Ask me first" turns it off', async () => {
    const line = buy().getByText('Runs start without asking first.')
    await line.waitFor({ timeout: 2000 })
    await buy().getByRole('button', { name: 'Ask me first' }).click()
    await line.waitFor({ state: 'detached', timeout: 5000 })
  })
  await step('cart: "Keep all marked" approves them, and Remove takes a product out', async () => {
    await buy().getByRole('button', { name: /^Keep all 2 marked/ }).click()
    await buy().getByText('Check this', { exact: true }).first().waitFor({ state: 'detached', timeout: 4000 })
    await buy().getByRole('button', { name: 'Remove Asparagus' }).click()
    await buy().getByRole('row', { name: /Asparagus/ }).waitFor({ state: 'detached', timeout: 4000 })
    return calls.join(', ')
  })
  await step('reload: the last run is read back from its saved order', async () => {
    await page.reload()
    await page.getByRole('heading', { name: 'Your household' }).waitFor()
    await nav('Grocery').click()
    await buy().getByRole('heading', { name: /^Paid:/ }).waitFor({ timeout: 8000 })
    await buy().getByRole('button', { name: 'Shop for what is left' }).waitFor()
  })
  await step('outcome: a run that paid nothing says so, with the reason it stopped', async () => {
    order = { ...order, status: 'unpaid', finish_reason: 'stopped_early', summary: { ...SHOP.summary, orders: [], paid_total_cents: 0, unmatched: [], cart: SHOP.cart } }
    cart = SHOP.cart
    await page.reload()
    await nav('Grocery').click()
    const nothing = await text(buy().getByText('Nothing was paid.').locator('xpath=..'))
    const early = await text(buy().getByText(/The agent stopped before it finished/))
    await shot('grocery-unpaid')
    order = { ...order, finish_reason: 'step_limit' }
    await page.reload()
    await nav('Grocery').click()
    const steps = await text(buy().getByText(/The agent ran out of steps/))
    return `${nothing} | ${early} | ${steps}`
  })
  await step('outcome: a failed run shows its error and the cart it had saved', async () => {
    order = { ...order, status: 'failed', error_message: 'The stores could not be reached.' }
    await page.reload()
    await nav('Grocery').click()
    const alert = await text(buy().getByRole('alert'))
    await buy().getByText('The products it had picked so far are saved in the cart.').waitFor()
    await shot('grocery-failed')
    return alert
  })
  await step('outcome: a run still going on the server is polled ("still shopping")', async () => {
    order = { ...order, status: 'shopping', error_message: null }
    await page.reload()
    await nav('Grocery').click()
    return text(buy().getByRole('status').filter({ hasText: 'The agent is still shopping' }))
  })
  await step('changed meals: the panel says the earlier run was for different meals', async () => {
    order = { id: SHOP.orderId, grocery_list_id: SHOP.listId, mode: 'manual', status: 'placed', summary: SHOP.summary, finish_reason: 'completed' }
    cart = SHOP.cartAfter
    await page.reload()
    await nav('Plan').click()
    await page.getByRole('button', { name: /^Breakfast on Monday/ }).click()
    await page.locator('#slot-meal').selectOption('')
    await nav('Grocery').click()
    const t = await text(buy().getByText(/The confirmed meals have changed since the agent last shopped/))
    await buy().getByRole('button', { name: 'Shop for these groceries' }).waitFor()
    return t
  })

  await step('setup change: avoiding a food swaps the meals that use it, with a note and no Undo', async () => {
    await nav('Setup').click()
    await page.locator('#disliked-foods').fill('bacon')
    await page.locator('#disliked-foods').press('Enter')
    await nav('Plan').click()
    return text(page.getByRole('status').filter({ hasText: 'What changed' }))
  })
  await step('setup: "Reset to defaults" restores the defaults but keeps the saved allergy locked', async () => {
    await nav('Setup').click()
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await page.waitForTimeout(300)
    const size = await page.locator('#household-size').inputValue()
    const locked = await page.getByRole('group', { name: 'Allergies' }).getByRole('checkbox', { name: /^Tree nuts/ }).isDisabled()
    if (size !== '2' || !locked) throw new Error(`size ${size}, locked ${locked}`)
    return `people ${size}, budget ${await page.locator('#budget').inputValue()}, period ${await page.locator('#planning-period').inputValue()}`
  })
  await page.unrouteAll()
  page.off('console', onConsole)
  page.off('pageerror', onPageError)
  return { log, errors }
}
