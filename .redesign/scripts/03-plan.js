async (page) => {
  const OUT = '/home/fedora/GitHub/FeedMe/.redesign/__PHASE__/'
  const BASE = 'http://localhost:5173'
  const FIXTURE = __FIXTURE__
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
  const nav = () => page.getByRole('navigation', { name: 'Main' })
  const select = (label) => page.getByRole('combobox', { name: label, exact: true })
  const chosen = (label) => select(label).evaluate((el) => el.options[el.selectedIndex]?.textContent ?? '')

  await page.unrouteAll()
  await page.route('**/api/meal-options', async (route) => {
    await new Promise((r) => setTimeout(r, 2500))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) })
  })

  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Your household' }).waitFor()
  await step('plan survives a reload, and the Plan tab opens it', async () => {
    await nav().getByRole('button', { name: 'Plan' }).click()
    await page.getByRole('heading', { name: 'Your meal plan' }).waitFor({ timeout: 3000 })
    return text(page.getByText(/people · \d+ days/))
  })
  await step('plan: the browser allergy check leaves out the pecan recipe and says so', async () =>
    text(page.getByRole('status').filter({ hasText: 'Heads up' })))
  await step('plan: week summary shows nutrition against the goals', async () => {
    const terms = await page.locator('dl dt').allTextContents()
    const values = await page.locator('dl dd').allTextContents()
    if (terms.length !== 5) throw new Error(`${terms.length} stats`)
    return terms.map((t, i) => `${t}: ${values[i]}`).join(' | ')
  })
  await step('plan: grid has 7 days × 3 meals with a Check column', async () => {
    const rows = await page.getByRole('table').locator('tbody tr').count()
    const selects = await page.getByRole('table').getByRole('combobox').count()
    if (rows !== 7 || selects !== 21) throw new Error(`${rows} rows, ${selects} selects`)
    return `Monday: ${await text(page.getByRole('row', { name: /^Monday/ }).locator('td').last())} | Saturday: ${await text(page.getByRole('row', { name: /^Saturday/ }).locator('td').last())}`
  })
  await shot('plan-initial')

  await step('plan: change a meal from its dropdown', async () => {
    const before = await chosen('Breakfast on day 1')
    const options = await select('Breakfast on day 1').locator('optgroup[label="Recipes"] option').allTextContents()
    const next = options.find((o) => o !== before && !o.includes('—'))
    await select('Breakfast on day 1').selectOption({ label: next })
    const after = await chosen('Breakfast on day 1')
    if (after !== next) throw new Error(`still ${after}`)
    return `${before} → ${after}`
  })
  await step('plan: changing a dinner fills the next day’s empty lunch with its leftovers', async () => {
    await select('Lunch on day 2').selectOption('')
    const options = await select('Dinner on day 1').locator('optgroup[label="Recipes"] option').allTextContents()
    const current = await chosen('Dinner on day 1')
    const next = options.find((o) => o !== current && !o.includes('—') && !o.includes('(yours)'))
    await select('Dinner on day 1').selectOption({ label: next })
    const lunch = await chosen('Lunch on day 2')
    if (lunch !== `Leftovers: ${next}`) throw new Error(`lunch is ${lunch}`)
    return lunch
  })
  await step('plan: people-per-meal box overrides the household size', async () => {
    await page.getByRole('spinbutton', { name: 'People for Dinner on day 1' }).fill('5')
    await page.getByRole('row', { name: /^Monday/ }).getByRole('button', { name: 'Recipe' }).last().click()
    const dialog = page.getByRole('dialog')
    const ctx = await text(dialog.getByText(/Dinner · Monday of Week 1/))
    if (!ctx.includes('5 servings')) throw new Error(ctx)
    return ctx
  })
  await step('recipe: planner recipe shows nutrition, ingredient names only, directions and the source note', async () => {
    const dialog = page.getByRole('dialog')
    for (const h of [/Nutrition per serving \(estimated\)/, 'Ingredients', /^Directions/]) {
      await dialog.getByRole('heading', { name: h }).waitFor({ timeout: 2000 })
    }
    await dialog.getByText('The recipe gives no amounts or prices, so none are shown.').waitFor()
    await dialog.getByText(/Chosen by the FeedMe planner/).waitFor()
    await page.waitForTimeout(800)
    await shot('recipe-modal', { full: false })
    return `${await dialog.locator('ol li').count()} steps`
  })
  await step('recipe: Accept, Reject and Save toggle their states', async () => {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Accept this meal' }).click()
    if (!(await dialog.getByRole('button', { name: 'Accepted' }).isDisabled())) throw new Error('accept')
    await dialog.getByRole('button', { name: 'Reject' }).click()
    if (!(await dialog.getByRole('button', { name: 'Rejected' }).isDisabled())) throw new Error('reject')
    await dialog.getByRole('button', { name: 'Accept this meal' }).click()
    await dialog.getByRole('button', { name: 'Save this recipe' }).click()
    if ((await dialog.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')) !== 'true') throw new Error('save')
  })
  await step('recipe: "Use this" swaps in an alternative and closes the dialog', async () => {
    const dialog = page.getByRole('dialog')
    const item = dialog.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Use this' }) }).first()
    const name = await text(item.locator('p').first())
    await item.getByRole('button', { name: 'Use this' }).click()
    if (await page.getByRole('dialog').count()) throw new Error('dialog still open')
    const now = await chosen('Dinner on day 1')
    if (now !== name) throw new Error(`${now} != ${name}`)
    return name
  })
  await step('recipe: "Suggest another" swaps the meal and leaves a note with nothing to undo', async () => {
    const before = await chosen('Breakfast on day 3')
    await page.getByRole('row', { name: /^Wednesday/ }).getByRole('button', { name: 'Recipe' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Suggest another' }).click()
    await page.keyboard.press('Escape')
    const note = await text(page.getByRole('status').filter({ hasText: 'What changed' }))
    if (!note.includes(`Swapped ${before}`)) throw new Error(note)
    return note
  })
  await step('recipe: clicking the backdrop closes the dialog', async () => {
    await page.getByRole('row', { name: /^Wednesday/ }).getByRole('button', { name: 'Recipe' }).first().click()
    await page.getByRole('dialog').waitFor()
    await page.mouse.click(8, 8)
    if (await page.getByRole('dialog').count()) throw new Error('still open')
  })
  await step('notes: "What changed" can be dismissed', async () => {
    const note = page.getByRole('status').filter({ hasText: 'What changed' })
    await note.getByRole('button', { name: 'Dismiss' }).click()
    if (await note.count()) throw new Error('still there')
  })

  // --- own recipes inside the plan
  await step('own recipe: offered in its slots, marked "(yours)"', async () => {
    const options = await select('Dinner on day 5').locator('option').allTextContents()
    const mine = options.find((o) => o.includes('(yours)'))
    if (!mine) throw new Error('not offered')
    await select('Dinner on day 5').selectOption({ label: mine })
    return mine
  })
  await step('own recipe: its recipe view has amounts and costs, and "Edit this recipe" opens the form', async () => {
    await page.getByRole('row', { name: /^Friday/ }).getByRole('button', { name: 'Recipe' }).last().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('columnheader', { name: 'Est. cost' }).waitFor({ timeout: 2000 })
    await dialog.getByRole('button', { name: 'Edit this recipe' }).click()
    await page.getByRole('dialog', { name: /^Edit Sunday Beef Chili/ }).waitFor({ timeout: 2000 })
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  })
  await step('own recipe: one with a household allergen is flagged in the form, the dropdown, the Check column and the recipe view; Confirm is blocked', async () => {
    await page.getByRole('button', { name: 'Add your own recipe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add your own recipe' })
    await dialog.locator('#recipe-name').fill('Almond Oat Bowl')
    await dialog.getByRole('checkbox', { name: 'Breakfast' }).check()
    await dialog.locator('#recipe-servings').fill('2')
    await dialog.locator('#recipe-time').fill('10')
    await dialog.locator('#recipe-calories').fill('800')
    await dialog.locator('#recipe-protein').fill('30')
    await dialog.locator('#recipe-carbs').fill('100')
    await dialog.locator('#recipe-fat').fill('30')
    await dialog.getByLabel('Ingredient 1 name').fill('Almonds')
    await dialog.getByLabel('Ingredient 1 amount').fill('2')
    await dialog.getByLabel('Ingredient 1 unit').fill('oz')
    await dialog.getByLabel('Ingredient 1 cost in dollars').fill('1.50')
    await dialog.locator('#recipe-instructions').fill('Soak the oats.\nTop with the almonds.')
    const warning = await text(dialog.getByRole('status').filter({ hasText: 'Worth checking' }))
    await dialog.getByRole('button', { name: 'Save recipe' }).click()

    const options = await select('Breakfast on day 2').locator('option').allTextContents()
    const flagged = options.find((o) => o.startsWith('Almond Oat Bowl'))
    await select('Breakfast on day 2').selectOption({ label: flagged })
    const checkCell = await text(page.getByRole('row', { name: /^Tuesday/ }).locator('td').last())
    const confirm = page.getByRole('button', { name: /onfirm this week/ })
    if (!(await confirm.isDisabled())) throw new Error('confirm not blocked')
    const fine = await text(page.getByText(/Fix the days marked in the Check column/))
    const fix = await text(page.locator('dl > div').filter({ hasText: 'Days needing a fix' }))
    await shot('plan-problem-day')

    await page.getByRole('row', { name: /^Tuesday/ }).getByRole('button', { name: 'Recipe' }).first().click()
    const alert = await text(page.getByRole('dialog').getByRole('alert'))
    await shot('recipe-modal-unsafe', { full: false })
    await page.getByRole('dialog').getByRole('button', { name: 'Use this' }).first().click()
    if (await confirm.isDisabled()) throw new Error('confirm still blocked after the swap')
    return `${warning} | option: ${flagged} | check: ${checkCell} | ${fine} | ${fix} | dialog: ${alert}`
  })

  // --- weeks, clear and undo
  await step('weeks: Week 2 is "not planned" and shows the empty state; "Edit setup" goes to Setup', async () => {
    const tab = page.getByRole('tab', { name: /Week 2/ })
    const label = await text(tab)
    await tab.click()
    if ((await tab.getAttribute('aria-selected')) !== 'true') throw new Error('not selected')
    await page.getByRole('heading', { name: 'Nothing planned for this week' }).waitFor({ timeout: 2000 })
    await shot('plan-week-empty')
    await page.getByRole('heading', { name: 'Nothing planned for this week' }).locator('xpath=..').getByRole('button', { name: 'Edit setup' }).click()
    await page.getByRole('heading', { name: 'Your household' }).waitFor({ timeout: 2000 })
    await nav().getByRole('button', { name: 'Plan' }).click()
    await page.getByRole('tab', { name: /Week 1/ }).click()
    return label
  })
  await step('remake: "Remake the plan" shows the waiting state and builds a new plan', async () => {
    await page.getByRole('button', { name: 'Remake the plan' }).click()
    await page.getByRole('button', { name: 'Remaking your plan…' }).waitFor({ timeout: 3000 })
    await page.getByText(/This takes about half a minute/).waitFor({ timeout: 3000 })
    await shot('plan-loading')
    const note = page.getByRole('status').filter({ hasText: 'What changed' })
    await note.waitFor({ timeout: 15000 })
    return text(note)
  })
  // Recorded as it is today: Week 1 is the only week Setup counts as "a plan",
  // so clearing it sends the user back to Setup and its Undo is out of reach.
  await step('clear: clearing Week 1 leaves no plan, so the app returns to Setup ("No plan yet")', async () => {
    await page.getByRole('button', { name: 'Clear this week' }).click()
    await page.getByRole('heading', { name: 'No plan yet' }).waitFor({ timeout: 3000 })
    await page.getByRole('button', { name: 'Generate meal plan' }).waitFor()
  })
  await step('two weeks: a 14-day plan fills Week 2, labelled "next week"', async () => {
    await page.unrouteAll()
    const two = JSON.parse(JSON.stringify(FIXTURE))
    two.plan_days = 14
    two.session_id = 'fixture-session-2'
    for (const options of Object.values(two.meals)) {
      options.forEach((option, rank) => { option.day_index = rank < 5 ? rank : rank < 7 ? rank + 2 : null })
    }
    await page.route('**/api/meal-options', async (route) => {
      await new Promise((r) => setTimeout(r, 1200))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(two) })
    })
    await page.locator('#planning-period').selectOption('14')
    await page.getByRole('button', { name: 'Generate meal plan' }).click()
    // The app is still on the Plan step underneath, so the new plan opens there.
    await page.getByRole('heading', { name: 'Your meal plan' }).waitFor({ timeout: 15000 })
    const tab = page.getByRole('tab', { name: /Week 2/ })
    const label = await text(tab)
    await tab.click()
    await page.getByRole('table').waitFor({ timeout: 2000 })
    const status = await text(page.getByText(/Week 2 of the plan/))
    await shot('plan-week2')
    return `${label} | ${status}`
  })
  await step('clear: "Clear this week" on Week 2 empties it and offers Undo, which restores it', async () => {
    const before = await chosen('Dinner on day 1')
    await page.getByRole('button', { name: 'Clear this week' }).click()
    const note = page.getByRole('status').filter({ hasText: 'What changed' })
    const t = await text(note)
    await page.getByRole('heading', { name: 'Nothing planned for this week' }).waitFor({ timeout: 2000 })
    await shot('plan-cleared')
    await note.getByRole('button', { name: /Undo the change to Week 2/ }).click()
    const after = await chosen('Dinner on day 1')
    if (after !== before) throw new Error(`${after} != ${before}`)
    const restored = await text(page.getByRole('status').filter({ hasText: 'What changed' }))
    await page.getByRole('tab', { name: /Week 1/ }).click()
    return `${t} | ${restored}`
  })

  // --- confirm
  await step('confirm: "Confirm this week" confirms, notes it, and unlocks Grocery', async () => {
    await select('Dinner on day 5').selectOption({ label: 'Sunday Beef Chili (yours)' })
    await page.getByRole('button', { name: 'Confirm this week' }).click()
    await page.getByRole('heading', { name: 'This week is confirmed' }).waitFor({ timeout: 2000 })
    await page.getByRole('button', { name: 'Re-confirm this week' }).waitFor()
    const hint = await text(nav().getByRole('button', { name: /Grocery/ }))
    if (hint !== 'Grocery') throw new Error(`nav still says ${hint}`)
    const note = await text(page.getByRole('status').filter({ hasText: 'What changed' }))
    await shot('plan-confirmed')
    return note
  })
  await step('keyboard: Tab reaches the plan controls with a visible focus ring', async () => {
    await select('Breakfast on day 1').focus()
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      const s = getComputedStyle(el)
      return `${el.getAttribute('aria-label')} · outline ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`
    })
    if (!info.includes('People for Breakfast on day 1')) throw new Error(info)
    return info
  })
  await step('confirm: "Go to grocery list" opens the Grocery step', async () => {
    await page.getByRole('button', { name: 'Go to grocery list' }).click()
    await page.getByRole('heading', { name: 'Your grocery list' }).waitFor({ timeout: 2000 })
  })

  page.off('console', onConsole)
  page.off('pageerror', onPageError)
  return { log, errors }
}
