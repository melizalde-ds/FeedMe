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

  await page.unrouteAll()
  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Your household' }).waitFor()
  await page.waitForTimeout(800)
  await shot('setup-initial')

  await step('nav: Plan tab stays on Setup while there is no plan', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Plan' }).click()
    await page.getByRole('heading', { name: 'Your household' }).waitFor({ timeout: 2000 })
  })
  await step('nav: Grocery tab shows "confirm a week first" and the empty Grocery page', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' })
    const hint = await text(nav.getByRole('button', { name: /Grocery/ }))
    await nav.getByRole('button', { name: /Grocery/ }).click()
    await page.getByRole('heading', { name: 'Confirm a week first' }).waitFor({ timeout: 2000 })
    await shot('grocery-unconfirmed')
    await page.getByRole('button', { name: 'Back to my plan' }).click()
    await page.getByRole('heading', { name: 'Your household' }).waitFor({ timeout: 2000 })
    return hint
  })

  // --- allergies
  const allergies = page.getByRole('group', { name: 'Allergies' })
  await step('allergies: tick Tree nuts, status line names it as unsaved', async () => {
    await allergies.getByRole('checkbox', { name: /^Tree nuts/ }).check()
    return text(allergies.getByRole('status'))
  })
  await step('allergies: untick an unsaved allergy', async () => {
    await allergies.getByRole('checkbox', { name: /^Sesame/ }).check()
    await allergies.getByRole('checkbox', { name: /^Sesame/ }).uncheck()
    const t = await text(allergies.getByRole('status'))
    if (t.includes('Sesame')) throw new Error('Sesame still listed')
    return t
  })
  await step('allergies: invalid custom allergen shows an error', async () => {
    await page.locator('#custom-allergen').fill('x')
    await allergies.getByRole('button', { name: 'Add' }).click()
    return text(page.locator('#custom-allergen-error'))
  })
  await step('allergies: add a custom allergen with Enter, then remove the unsaved chip', async () => {
    await page.locator('#custom-allergen').fill('mustard')
    await page.locator('#custom-allergen').press('Enter')
    const chip = page.getByRole('list', { name: 'Other allergens' }).getByRole('button', { name: /mustard/ })
    await chip.waitFor({ timeout: 2000 })
    await chip.click()
    if (await page.getByRole('list', { name: 'Other allergens' }).count()) throw new Error('chip not removed')
  })

  // --- household
  await step('household: size 0 shows a problem, 3 clears it and updates the hint', async () => {
    await page.locator('#household-size').fill('0')
    const problem = await text(page.locator('#household-size').locator('xpath=..').locator('p').last())
    await page.locator('#household-size').fill('3')
    const hint = await text(page.locator('#household-size').locator('xpath=..').locator('p').first())
    if (!hint.includes('3 servings')) throw new Error('hint: ' + hint)
    return `${problem} | ${hint}`
  })
  await step('household: planning period select', async () => {
    await page.locator('#planning-period').selectOption('5')
  })

  // --- diet and tastes
  await step('diet: toggle Vegetarian on and off', async () => {
    const box = page.getByRole('group', { name: 'Diet and tastes' }).getByRole('checkbox', { name: 'Vegetarian' })
    await box.check(); await box.uncheck()
  })
  await step('tastes: add liked food, duplicate is refused', async () => {
    await page.locator('#liked-foods').fill('chicken')
    await page.locator('#liked-foods').press('Enter')
    await page.getByRole('list', { name: 'Foods you like' }).getByRole('button', { name: /chicken/ }).waitFor({ timeout: 2000 })
    await page.locator('#liked-foods').fill('chicken')
    await page.locator('#liked-foods').press('Enter')
    return text(page.locator('#liked-foods-error'))
  })
  await step('tastes: a liked food can not also be avoided', async () => {
    await page.locator('#liked-foods').fill('')
    await page.locator('#disliked-foods').fill('chicken')
    await page.locator('#disliked-foods').press('Enter')
    const t = await text(page.locator('#disliked-foods-error'))
    await page.locator('#disliked-foods').fill('anchovies')
    await page.locator('#disliked-foods').locator('xpath=..').getByRole('button', { name: 'Add' }).click()
    await page.getByRole('list', { name: 'Foods you avoid' }).getByRole('button', { name: /anchovies/ }).waitFor({ timeout: 2000 })
    return t
  })
  await step('tastes: remove a term chip', async () => {
    await page.getByRole('list', { name: 'Foods you avoid' }).getByRole('button', { name: /anchovies/ }).click()
    if (await page.getByRole('list', { name: 'Foods you avoid' }).count()) throw new Error('chip not removed')
  })

  // --- goals
  await step('goals: calories under 1200 is refused', async () => {
    await page.locator('#calorie-goal').fill('1000')
    return text(page.locator('#calorie-goal-error'))
  })
  await step('goals: macros off the calorie target are flagged, and the save bar blocks', async () => {
    await page.locator('#calorie-goal').fill('2400')
    const goals = page.getByRole('group', { name: 'Goals and limits' })
    const macro = await text(goals.getByRole('alert'))
    const bar = await text(page.getByText('Fix the fields marked above before saving.'))
    await shot('setup-validation')
    return `${macro} | ${bar}`
  })
  await step('goals: "Recalculate carbs and fat" clears the macro problem', async () => {
    await page.getByRole('button', { name: 'Recalculate carbs and fat' }).click()
    await page.waitForTimeout(200)
    const goals = page.getByRole('group', { name: 'Goals and limits' })
    if (await goals.getByRole('alert').count()) throw new Error('still flagged')
    return `carbs ${await page.locator('#carbs-goal').inputValue()} g, fat ${await page.locator('#fat-goal').inputValue()} g`
  })
  // Pre-existing defect, recorded and not fixed: the carbs field has step=5,
  // and "Recalculate" can write a value that is not a multiple of 5. The
  // browser's own validation then blocks "Generate meal plan" with a tooltip.
  {
    const invalid = await page.evaluate(() =>
      [...document.querySelector('form').elements]
        .filter((el) => el.willValidate && !el.checkValidity())
        .map((el) => `${el.id}=${el.value}: ${el.validationMessage}`))
    log.push(`INFO native validation after recalculating: ${invalid.length ? invalid.join(' | ') : 'all fields valid'}`)
    if (invalid.length) await page.locator('#carbs-goal').fill('315')
  }
  await step('goals: budget and time per meal', async () => {
    await page.locator('#budget').fill('120')
    await page.locator('#cooking-time').selectOption('30')
  })

  // --- save
  await step('save: "Save to my account" reports saving then saved', async () => {
    await page.getByRole('button', { name: 'Save to my account' }).click()
    await page.getByText('Saved to your account.').waitFor({ timeout: 10000 })
  })
  await step('save: after a reload the saved allergy is locked and the setup is still there', async () => {
    await page.reload()
    await page.getByRole('heading', { name: 'Your household' }).waitFor()
    const box = page.getByRole('group', { name: 'Allergies' }).getByRole('checkbox', { name: /^Tree nuts/ })
    await box.waitFor()
    await page.getByText("(saved, can’t be removed)").first().waitFor({ timeout: 8000 })
    if (!(await box.isDisabled()) || !(await box.isChecked())) throw new Error('not locked')
    if ((await page.locator('#household-size').inputValue()) !== '3') throw new Error('size lost')
    if ((await page.locator('#budget').inputValue()) !== '120') throw new Error('budget lost')
    return text(page.getByRole('group', { name: 'Allergies' }).getByRole('status'))
  })
  await shot('setup-filled')

  // --- the planner, live: its real answer on this machine
  await step('plan: live planner request shows the waiting state, then its real answer', async () => {
    await page.getByRole('button', { name: 'Generate meal plan' }).click()
    await page.getByText(/This takes about half a minute/).waitFor({ timeout: 5000 })
    const disabled = await page.getByRole('button', { name: 'Building your plan…' }).isDisabled()
    if (!disabled) throw new Error('submit not disabled while loading')
    const banner = page.getByRole('alert').filter({ hasText: 'We could not build that plan' })
    await banner.waitFor({ timeout: 95000 })
    const t = await text(banner)
    await shot('setup-plan-error')
    await banner.getByRole('button', { name: 'Dismiss' }).click()
    if (await banner.count()) throw new Error('banner not dismissed')
    return t
  })

  // --- own recipes
  await step('recipes: empty state, then the form refuses an empty save', async () => {
    await page.getByText('Nothing here yet.').waitFor({ timeout: 2000 })
    await page.getByRole('button', { name: 'Add a recipe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add your own recipe' })
    await dialog.waitFor()
    await shot('recipe-form-empty', { full: false })
    await dialog.getByRole('button', { name: 'Save recipe' }).click()
    const n = await dialog.getByRole('alert').count()
    if (n < 3) throw new Error(`only ${n} alerts`)
    await shot('recipe-form-errors', { full: false })
    return `${n} alerts, e.g. ${await text(dialog.getByRole('alert'))}`
  })
  await step('recipes: Escape closes the dialog', async () => {
    await page.keyboard.press('Escape')
    if (await page.getByRole('dialog').count()) throw new Error('still open')
  })
  await step('recipes: fill and save a recipe; allergens are detected from ingredients', async () => {
    await page.getByRole('button', { name: 'Add a recipe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add your own recipe' })
    await dialog.locator('#recipe-name').fill('Sunday Chili')
    await dialog.getByRole('checkbox', { name: 'Dinner' }).check()
    await dialog.getByRole('checkbox', { name: 'Lunch' }).check()
    await dialog.locator('#recipe-servings').fill('4')
    await dialog.locator('#recipe-time').fill('30')
    await dialog.locator('#recipe-calories').fill('2200')
    await dialog.locator('#recipe-protein').fill('140')
    await dialog.locator('#recipe-carbs').fill('180')
    await dialog.locator('#recipe-fat').fill('90')
    await dialog.getByLabel('Ingredient 1 name').fill('Ground beef')
    await dialog.getByLabel('Ingredient 1 amount').fill('1')
    await dialog.getByLabel('Ingredient 1 unit').fill('lb')
    await dialog.getByLabel('Ingredient 1 cost in dollars').fill('6.50')
    await dialog.getByRole('button', { name: 'Add another ingredient' }).click()
    await dialog.getByLabel('Ingredient 2 name').fill('Cheddar cheese')
    await dialog.getByLabel('Ingredient 2 amount').fill('8')
    await dialog.getByLabel('Ingredient 2 unit').fill('oz')
    await dialog.getByLabel('Ingredient 2 cost in dollars').fill('3.25')
    await dialog.getByRole('button', { name: 'Add another ingredient' }).click()
    await dialog.getByRole('button', { name: 'Remove ingredient 3' }).click()
    const milk = dialog.getByRole('checkbox', { name: /^Milk/ })
    if (!(await milk.isChecked()) || !(await milk.isDisabled())) throw new Error('Milk not auto-detected')
    await dialog.locator('#recipe-instructions').fill('Brown the beef.\nAdd everything else and simmer for 20 minutes.\nTop with the cheese.')
    const perServing = await text(dialog.getByText(/^Per serving, across/))
    await shot('recipe-form-filled', { full: false })
    await dialog.getByRole('button', { name: 'Save recipe' }).click()
    await page.getByRole('heading', { name: 'Sunday Chili' }).waitFor({ timeout: 3000 })
    return `${perServing} | ${await text(page.locator('#my-recipes-title').locator('xpath=..').getByRole('status'))}`
  })
  await step('recipes: View opens the recipe scaled to the household', async () => {
    const card = page.getByRole('article').filter({ hasText: 'Sunday Chili' })
    await card.getByRole('button', { name: 'View' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sunday Chili' })
    await dialog.waitFor()
    const ctx = await text(dialog.getByText(/Your recipe, scaled to/))
    await dialog.getByRole('columnheader', { name: 'Est. cost' }).waitFor()
    await shot('recipe-view-own', { full: false })
    await dialog.getByRole('button', { name: 'Close' }).click()
    return ctx
  })
  await step('recipes: Edit renames the recipe', async () => {
    const card = page.getByRole('article').filter({ hasText: 'Sunday Chili' })
    await card.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Sunday Chili' })
    await dialog.locator('#recipe-name').fill('Sunday Beef Chili')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('heading', { name: 'Sunday Beef Chili' }).waitFor({ timeout: 3000 })
  })
  await shot('setup-with-recipe')
  await step('recipes: Delete asks first; "Keep it" cancels', async () => {
    const card = page.getByRole('article').filter({ hasText: 'Sunday Beef Chili' })
    await card.getByRole('button', { name: 'Delete' }).click()
    await card.getByRole('button', { name: 'Yes, delete' }).waitFor()
    await card.getByRole('button', { name: 'Keep it' }).click()
    await card.getByRole('button', { name: 'Delete' }).waitFor()
  })

  // --- the planner, answered from the fixture (real dataset rows)
  await page.route('**/api/meal-options', async (route) => {
    await new Promise((r) => setTimeout(r, 2500))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) })
  })
  await step('plan: generate (fixture answer) shows the waiting state then "Your plan is ready"', async () => {
    await page.getByRole('button', { name: 'Generate meal plan' }).click()
    await page.getByText(/This takes about half a minute/).waitFor({ timeout: 5000 })
    await shot('setup-plan-loading')
    await page.getByRole('heading', { name: 'Your plan is ready' }).waitFor({ timeout: 15000 })
    const note = await text(page.getByRole('heading', { name: 'Your plan is ready' }).locator('xpath=..').locator('p'))
    await page.getByRole('button', { name: 'Rebuild my plan' }).waitFor()
    await shot('setup-plan-ready')
    return note
  })
  await step('plan: "See your plan" opens the Plan step', async () => {
    await page.getByRole('button', { name: 'See your plan' }).click()
    await page.getByRole('heading', { name: 'Your meal plan' }).waitFor({ timeout: 3000 })
  })

  page.off('console', onConsole)
  page.off('pageerror', onPageError)
  return { log, errors }
}
