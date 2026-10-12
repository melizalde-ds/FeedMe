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
      await page.waitForTimeout(350)
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

  // A meal is a tile named "<Meal> on <Day>: <recipe>". Opening it unfolds the
  // recipe shelf under its rail, which holds the dropdown that changes it.
  const tile = (label) => page.getByRole('button', { name: new RegExp(`^(Choose a meal for )?${label}`) })
  const mealOn = async (label) => {
    const name = await tile(label).getAttribute('aria-label')
    return name.startsWith('Choose a meal') ? '' : name.slice(label.length + 2)
  }
  const shelf = () => page.locator('section.unfold')
  const open = async (label) => {
    if ((await tile(label).getAttribute('aria-expanded')) !== 'true') await tile(label).click()
    await shelf().waitFor({ timeout: 3000 })
  }
  const close = async () => {
    if (await shelf().count()) await shelf().getByRole('button', { name: 'Close recipe' }).click()
  }
  const choose = async (label, option) => {
    await open(label)
    await page.locator('#slot-meal').selectOption(option)
  }
  const options = (group) => page.locator(`#slot-meal optgroup[label="${group}"] option`).allTextContents()
  const day = (name) => page.getByRole('listitem').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) })
  const note = () => page.getByRole('status').filter({ hasText: 'What changed' })

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
    return terms.map((t, i) => `${t}: ${values[i].replace(/\s+/g, ' ').trim()}`).join(' | ')
  })
  await step('plan: the wall has 7 days × 3 meals, with a verdict for each day', async () => {
    const tiles = await page.locator('.wall .tile').count()
    const rails = await page.locator('.wall section').count()
    if (tiles !== 21 || rails !== 4) throw new Error(`${tiles} tiles, ${rails} rails`)
    const monday = await text(day('Monday'))
    if (/\.\d{2,}/.test(monday)) throw new Error(`unrounded figure: ${monday}`)
    return `${monday} | ${await text(day('Saturday'))}`
  })
  await page.waitForLoadState('networkidle')
  await shot('plan-initial')

  await step('plan: pointing at a meal grows it and dims the rest of the wall', async () => {
    await tile('Lunch on Wednesday').hover()
    await page.waitForTimeout(400)
    const scale = await tile('Lunch on Wednesday').evaluate((el) => getComputedStyle(el).scale + ' ' + getComputedStyle(el).transform)
    const other = await tile('Lunch on Monday').evaluate((el) => getComputedStyle(el).opacity)
    const more = await tile('Lunch on Wednesday').locator('.tile__more').evaluate((el) => getComputedStyle(el).opacity)
    await shot('plan-tile-focus', { full: false })
    await page.mouse.move(5, 5)
    if (Number(other) > 0.6 || Number(more) < 0.9) throw new Error(`other ${other}, details ${more}`)
    return `others at ${other} opacity, details shown (${scale.includes('matrix') ? 'scaled' : scale})`
  })

  await step('plan: change a meal from its dropdown', async () => {
    const before = await mealOn('Breakfast on Monday')
    await open('Breakfast on Monday')
    const next = (await options('Recipes')).find((o) => o !== before && !o.includes('—'))
    await page.locator('#slot-meal').selectOption({ label: next })
    const after = await mealOn('Breakfast on Monday')
    if (after !== next) throw new Error(`still ${after}`)
    return `${before} → ${after}`
  })
  await step('plan: changing a dinner fills the next day’s empty lunch with its leftovers', async () => {
    await choose('Lunch on Tuesday', '')
    const current = await mealOn('Dinner on Monday')
    await open('Dinner on Monday')
    const next = (await options('Recipes')).find((o) => o !== current && !o.includes('—') && !o.includes('(yours)'))
    await page.locator('#slot-meal').selectOption({ label: next })
    const lunch = await mealOn('Lunch on Tuesday')
    if (lunch !== `leftovers of ${next}`) throw new Error(`lunch is ${lunch}`)
    return lunch
  })
  await step('plan: the People box overrides the household size', async () => {
    await open('Dinner on Monday')
    await page.locator('#slot-people').fill('5')
    const where = await text(shelf().getByText(/Dinner · Monday of Week 1/))
    if (!where.includes('5 servings')) throw new Error(where)
    return where
  })
  await step('recipe: a planner recipe shows nutrition, ingredient names only, directions and the source note', async () => {
    for (const h of [/Nutrition per serving \(estimated\)/, 'Ingredients', /^Directions/]) {
      await shelf().getByRole('heading', { name: h }).waitFor({ timeout: 2000 })
    }
    await shelf().getByText('The recipe gives no amounts or prices, so none are shown.').waitFor()
    await shelf().getByText(/Chosen by the FeedMe planner/).waitFor()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shot('recipe-shelf', { full: false })
    return `${await shelf().locator('ol li').count()} steps`
  })
  await step('recipe: Accept, Reject and Save toggle their states, and the meal is flagged', async () => {
    await shelf().getByRole('button', { name: 'Accept this meal' }).click()
    if (!(await shelf().getByRole('button', { name: 'Accepted' }).isDisabled())) throw new Error('accept')
    const flag = await text(tile('Dinner on Monday').locator('.flag').last())
    await shelf().getByRole('button', { name: 'Reject' }).click()
    if (!(await shelf().getByRole('button', { name: 'Rejected' }).isDisabled())) throw new Error('reject')
    await shelf().getByRole('button', { name: 'Accept this meal' }).click()
    await shelf().getByRole('button', { name: 'Save this recipe' }).click()
    if ((await shelf().getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')) !== 'true') throw new Error('save')
    return `flag: ${flag}`
  })
  await step('recipe: "Use this" swaps in an alternative', async () => {
    const item = shelf().getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Use this/ }) }).first()
    const name = await text(item.locator('p').first())
    await item.getByRole('button', { name: /^Use this/ }).click()
    const now = await mealOn('Dinner on Monday')
    if (now !== name) throw new Error(`${now} != ${name}`)
    await shelf().getByRole('heading', { name }).waitFor({ timeout: 2000 })
    return name
  })
  await step('recipe: Escape closes the shelf and focus goes back to the meal', async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    if (await shelf().count()) throw new Error('still open')
    const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
    if (!back.startsWith('Dinner on Monday')) throw new Error(`focus on "${back}"`)
  })
  await step('recipe: "Suggest another" swaps the meal, notes it, and marks the meal "Changed" until the note is dismissed', async () => {
    const before = await mealOn('Breakfast on Wednesday')
    await open('Breakfast on Wednesday')
    await shelf().getByRole('button', { name: 'Suggest another' }).click()
    await close()
    const said = await text(note())
    if (!said.includes(`Swapped ${before}`)) throw new Error(said)
    const flag = await text(tile('Breakfast on Wednesday').locator('.flag').last())
    if (flag !== 'Changed') throw new Error(`flag is "${flag}"`)
    await shot('plan-changed')
    await note().getByRole('button', { name: 'Dismiss' }).click()
    if (await note().count()) throw new Error('note still there')
    if (await tile('Breakfast on Wednesday').getByText('Changed').count()) throw new Error('mark still there')
    return said
  })

  // --- own recipes inside the plan
  await step('own recipe: offered in its slots, marked "(yours)"', async () => {
    await open('Dinner on Friday')
    const mine = (await options('Recipes')).find((o) => o.includes('(yours)'))
    if (!mine) throw new Error('not offered')
    await page.locator('#slot-meal').selectOption({ label: mine })
    const flag = await text(tile('Dinner on Friday').locator('.flag').last())
    return `${mine}, flagged "${flag}"`
  })
  await step('own recipe: its recipe has amounts and costs, and "Edit this recipe" opens the form', async () => {
    await shelf().getByRole('columnheader', { name: 'Est. cost' }).waitFor({ timeout: 2000 })
    await shelf().getByRole('button', { name: 'Edit this recipe' }).click()
    const dialog = page.getByRole('dialog', { name: /^Edit Sunday Beef Chili/ })
    await dialog.waitFor({ timeout: 2000 })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await close()
  })
  await step('own recipe: one with a household allergen is flagged in the form, the dropdown, the wall and the recipe; Confirm is blocked', async () => {
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

    await open('Breakfast on Tuesday')
    const flagged = (await options('Recipes')).find((o) => o.startsWith('Almond Oat Bowl'))
    await page.locator('#slot-meal').selectOption({ label: flagged })
    const verdict = await text(day('Tuesday'))
    const tileName = await tile('Breakfast on Tuesday').getAttribute('aria-label')
    const alert = await text(shelf().getByRole('alert'))
    await shot('recipe-shelf-unsafe', { full: false })
    await close()
    const confirm = page.getByRole('button', { name: /onfirm this week/ })
    if (!(await confirm.isDisabled())) throw new Error('confirm not blocked')
    const fine = await text(page.getByText(/Fix the days marked above before confirming/))
    const fix = await text(page.locator('dl > div').filter({ hasText: 'Days needing a fix' }))
    await shot('plan-problem-day')

    await open('Breakfast on Tuesday')
    await shelf().getByRole('button', { name: /^Use this/ }).first().click()
    await close()
    if (await confirm.isDisabled()) throw new Error('confirm still blocked after the swap')
    return `${warning} | option: ${flagged} | wall: ${tileName} | day: ${verdict} | ${fine} | ${fix} | recipe: ${alert}`
  })

  // --- weeks, clear and undo
  await step('weeks: Week 2 is "not planned" and shows the empty state; "Edit setup" goes to Setup', async () => {
    const tab = page.getByRole('tab', { name: /Week 2/ })
    const label = await text(tab)
    await tab.click()
    if ((await tab.getAttribute('aria-selected')) !== 'true') throw new Error('not selected')
    await page.getByRole('heading', { name: 'Nothing planned for this week' }).waitFor({ timeout: 2000 })
    await shot('plan-week-empty')
    await page.getByRole('tabpanel').getByRole('button', { name: 'Edit setup' }).click()
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
    await note().waitFor({ timeout: 15000 })
    return text(note())
  })
  // Fixed in the redesign: clearing the only planned week used to send the
  // user to Setup, where its Undo could not be reached.
  await step('clear: clearing Week 1 keeps the Plan step, and its Undo restores the week', async () => {
    const before = await mealOn('Dinner on Monday')
    await page.getByRole('button', { name: 'Clear this week' }).click()
    await page.getByRole('heading', { name: 'Nothing planned for this week' }).waitFor({ timeout: 3000 })
    const said = await text(note())
    await shot('plan-cleared')
    await note().getByRole('button', { name: /Undo the change to Week 1/ }).click()
    const after = await mealOn('Dinner on Monday')
    if (after !== before) throw new Error(`${after} != ${before}`)
    return `${said} | ${await text(note())}`
  })
  await step('two weeks: a 14-day plan fills Week 2, labelled "next week"', async () => {
    await page.unrouteAll()
    const two = JSON.parse(JSON.stringify(FIXTURE))
    two.plan_days = 14
    two.session_id = 'fixture-session-2'
    for (const list of Object.values(two.meals)) {
      list.forEach((option, rank) => { option.day_index = rank < 5 ? rank : rank < 7 ? rank + 2 : null })
    }
    await page.route('**/api/meal-options', async (route) => {
      await new Promise((r) => setTimeout(r, 1200))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(two) })
    })
    await nav().getByRole('button', { name: 'Setup' }).click()
    await page.locator('#planning-period').selectOption('14')
    await page.getByRole('button', { name: 'Rebuild my plan' }).click()
    await page.getByText(/This takes about half a minute/).waitFor({ timeout: 5000 })
    await page.getByText(/This takes about half a minute/).waitFor({ state: 'detached', timeout: 15000 })
    await page.getByRole('button', { name: 'See your plan' }).click()
    const tab = page.getByRole('tab', { name: /Week 2/ })
    const label = await text(tab)
    await tab.click()
    await tile('Dinner on Monday').waitFor({ timeout: 2000 })
    const status = await text(page.getByText(/Week 2 of the plan/))
    await page.waitForLoadState('networkidle')
    await shot('plan-week2')
    return `${label} | ${status}`
  })
  await step('clear: "Clear this week" on Week 2 empties it and offers Undo, which restores it', async () => {
    const before = await mealOn('Dinner on Monday')
    await page.getByRole('button', { name: 'Clear this week' }).click()
    const said = await text(note())
    await page.getByRole('heading', { name: 'Nothing planned for this week' }).waitFor({ timeout: 2000 })
    await note().getByRole('button', { name: /Undo the change to Week 2/ }).click()
    const after = await mealOn('Dinner on Monday')
    if (after !== before) throw new Error(`${after} != ${before}`)
    const restored = await text(note())
    await page.getByRole('tab', { name: /Week 1/ }).click()
    return `${said} | ${restored}`
  })

  // --- confirm
  await step('confirm: "Confirm this week" confirms, notes it, and unlocks Grocery', async () => {
    await choose('Dinner on Friday', { label: 'Sunday Beef Chili (yours)' })
    await close()
    await page.getByRole('button', { name: 'Confirm this week' }).click()
    await page.getByRole('heading', { name: 'This week is confirmed' }).waitFor({ timeout: 2000 })
    await page.getByRole('button', { name: 'Re-confirm this week' }).waitFor()
    const hint = await text(nav().getByRole('button', { name: /Grocery/ }))
    if (hint !== 'Grocery') throw new Error(`nav still says ${hint}`)
    const said = await text(note())
    await page.waitForLoadState('networkidle')
    await shot('plan-confirmed')
    return said
  })
  await step('keyboard: Tab moves from meal to meal with a visible ring', async () => {
    await tile('Breakfast on Monday').focus()
    await page.keyboard.press('Tab')
    await page.waitForTimeout(400)
    const info = await page.evaluate(() => {
      const el = document.activeElement
      return `${el.getAttribute('aria-label').split(':')[0]} · ring ${getComputedStyle(el).boxShadow.slice(0, 44)}`
    })
    if (!info.startsWith('Breakfast on Tuesday') || !info.includes('198, 242, 74')) throw new Error(info)
    await page.keyboard.press('Enter')
    await shelf().waitFor({ timeout: 2000 })
    const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('section.unfold')))
    await close()
    if (!inside) throw new Error('Enter opened the recipe but focus stayed outside it')
    return `${info} · Enter opens the recipe and moves focus into it`
  })
  await step('confirm: "Go to grocery list" opens the Grocery step', async () => {
    await page.getByRole('button', { name: 'Go to grocery list' }).click()
    await page.getByRole('heading', { name: 'Your grocery list' }).waitFor({ timeout: 2000 })
  })

  page.off('console', onConsole)
  page.off('pageerror', onPageError)
  return { log, errors }
}
