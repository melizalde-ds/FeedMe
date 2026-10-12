async (page) => {
  // Content at its limits: the longest recipe name the form allows, with no
  // space to break at, and the longest allergen term. Nothing may push the
  // page sideways. Signed in, with a plan.
  const BASE = 'http://localhost:5173'
  const OUT = '/home/fedora/GitHub/FeedMe/.redesign/__PHASE__/'
  const NAME = 'Supercalifragilisticexpialidocious' + 'Casserole'.repeat(5) + 'X'
  const TERM = 'pneumonoultramicroscopicsilicovolcanoconi'.slice(0, 40)
  const log = []
  const errors = []
  const onPageError = (e) => errors.push(`pageerror ${e.message}`)
  page.on('pageerror', onPageError)
  const step = async (name, fn) => {
    try { const d = await fn(); log.push(`PASS ${name}${d ? ' — ' + d : ''}`) } catch (e) { log.push(`FAIL ${name} — ${String(e.message).split('\n')[0]}`) }
  }
  const nav = (name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const widest = () => page.evaluate(() => {
    const limit = document.documentElement.clientWidth
    return [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > limit + 1 && !el.closest('.rail__tiles'))
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`)
      .join(', ')
  })
  const spill = (selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => el.scrollWidth > el.clientWidth + 1).length, selector)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Your household' }).waitFor()

  await step(`an ${NAME.length}-character recipe name with no spaces saves`, async () => {
    if (await page.getByRole('heading', { name: NAME }).count()) return 'already there'
    await page.getByRole('button', { name: 'Add a recipe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add your own recipe' })
    await dialog.locator('#recipe-name').fill(NAME)
    await dialog.getByRole('checkbox', { name: 'Dinner' }).check()
    await dialog.locator('#recipe-servings').fill('4')
    await dialog.locator('#recipe-time').fill('30')
    await dialog.locator('#recipe-calories').fill('2000')
    await dialog.locator('#recipe-protein').fill('100')
    await dialog.locator('#recipe-carbs').fill('200')
    await dialog.locator('#recipe-fat').fill('80')
    await dialog.getByLabel('Ingredient 1 name').fill('Potatoes')
    await dialog.getByLabel('Ingredient 1 amount').fill('2')
    await dialog.getByLabel('Ingredient 1 unit').fill('lb')
    await dialog.getByLabel('Ingredient 1 cost in dollars').fill('3')
    await dialog.locator('#recipe-instructions').fill('Bake it.')
    await dialog.getByRole('button', { name: 'Save recipe' }).click()
    await page.getByRole('heading', { name: NAME }).waitFor({ timeout: 3000 })
  })
  await step('a 40-character allergen term is added as a chip', async () => {
    if (await page.getByRole('list', { name: 'Other allergens' }).getByRole('button', { name: new RegExp(TERM) }).count()) return 'already there'
    await page.locator('#custom-allergen').fill(TERM)
    await page.locator('#custom-allergen').press('Enter')
    await page.getByRole('list', { name: 'Other allergens' }).getByRole('button', { name: new RegExp(TERM) }).waitFor({ timeout: 2000 })
  })
  await step('the meal is put on the wall and its week confirmed', async () => {
    await nav('Plan').click()
    await page.getByRole('button', { name: /^(Choose a meal for )?Dinner on Thursday/ }).click()
    await page.locator('#slot-meal').selectOption({ label: `${NAME} (yours)` })
    await page.getByRole('button', { name: /onfirm this week/ }).click()
    await page.getByRole('heading', { name: 'This week is confirmed' }).waitFor()
  })

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await step(`${width}px: Setup holds the long name and the long term`, async () => {
      await nav('Setup').click()
      await page.waitForTimeout(300)
      const over = await overflow()
      await page.getByRole('heading', { name: NAME }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${OUT}long-setup-${width}.png` })
      if (over > 0) throw new Error(`page scrolls sideways by ${over}px: ${await widest()}`)
    })
    await step(`${width}px: the wall and the recipe shelf hold the long name`, async () => {
      await nav('Plan').click()
      const tile = page.getByRole('button', { name: /^Dinner on Thursday/ })
      if ((await tile.getAttribute('aria-expanded')) !== 'true') await tile.click()
      await page.locator('section.unfold').waitFor()
      await page.waitForTimeout(500)
      const over = await overflow()
      const clipped = await spill('section.unfold h3, section.unfold p')
      await page.screenshot({ path: `${OUT}long-plan-${width}.png` })
      await page.keyboard.press('Escape')
      if (over > 0 || clipped) throw new Error(`sideways ${over}px (${await widest()}), ${clipped} clipped lines in the shelf`)
    })
    await step(`${width}px: the grocery list and the agent's notice hold the long name`, async () => {
      await nav(/Grocery/).click()
      await page.getByRole('heading', { name: 'Your grocery list' }).waitFor()
      await page.waitForTimeout(300)
      const over = await overflow()
      await page.getByText('Not shopped for:').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${OUT}long-grocery-${width}.png` })
      if (over > 0) throw new Error(`page scrolls sideways by ${over}px: ${await widest()}`)
    })
  }

  // Put things back: the term was never saved, so it can be removed.
  await page.setViewportSize({ width: 1440, height: 900 })
  await nav('Setup').click()
  await page.getByRole('list', { name: 'Other allergens' }).getByRole('button', { name: new RegExp(TERM) }).click()
  page.off('pageerror', onPageError)
  return { log, errors }
}
