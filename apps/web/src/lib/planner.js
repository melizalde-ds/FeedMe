// The plan's shape, the checks the Plan view renders, and the edits made to a
// plan in the browser. Meals themselves come from the planner service
// (mealOptions.js) or from the user's own recipes; nothing is generated here.
//
// A plan is a grid: weeks[week][day][slot]. Each cell names a recipe from the
// plan's own catalog rather than embedding it, so leftovers can point at the
// meal they came from and a recipe swap only has to be applied once.

import {
  COOL_OFF_DAYS,
  CURRENT_WEEK,
  CUSTOM_RECIPE_SOURCE,
  MEAL_SLOTS,
  MEAL_STATUS,
  WEEKS_IN_PLAN,
} from './constants.js'
import { fillsSlot, isRecipeCompliant, recipeProblems } from './mealFilters.js'

const DAYS_PER_WEEK = 7

const round = (value, places = 2) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`

export const emptySlot = () => ({
  recipe: null,
  leftover: false,
  servings: null,
  status: MEAL_STATUS.PENDING,
  saved: false,
})

const emptyDay = () => MEAL_SLOTS.map(() => emptySlot())
const emptyWeek = () => Array.from({ length: DAYS_PER_WEEK }, emptyDay)

export const emptyWeeks = () => Array.from({ length: WEEKS_IN_PLAN }, emptyWeek)

// A plan nobody has built yet: no meals and no recipes of its own. The user's
// own recipes are layered over it by the MealPlanProvider.
export function createEmptyPlan() {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    source: null,
    recipes: [],
    weeks: emptyWeeks(),
    confirmedWeek: null,
    warnings: [],
  }
}

// --- catalog -----------------------------------------------------------------

export function findRecipe(plan, name) {
  if (!name) return null
  return plan.recipes.find((recipe) => recipe.name === name) ?? null
}

// Only the user's own recipes carry prices: the ones they typed in.
export function recipeCostPerServing(recipe) {
  return round(
    (recipe.ingredients ?? []).reduce(
      (sum, ingredient) => sum + (ingredient.cost ?? 0),
      0,
    ),
  )
}

function recipesForSlot(plan, slotIndex) {
  const slot = MEAL_SLOTS[slotIndex]
  return plan.recipes.filter((recipe) => fillsSlot(recipe, slot))
}

// --- slot helpers ------------------------------------------------------------

export const slotServings = (slot, preferences) => {
  const override = Number(slot.servings)
  return override >= 1 ? override : Math.max(1, Number(preferences.householdSize) || 1)
}

const flatIndex = (week, day, slotIndex) =>
  (week * DAYS_PER_WEEK + day) * MEAL_SLOTS.length + slotIndex

// Walks the whole plan in order so a leftover slot can prove its source meal
// was cooked before it.
function cookedBefore(plan, week, day, slotIndex, name) {
  const limit = flatIndex(week, day, slotIndex)

  for (let w = 0; w < plan.weeks.length; w += 1) {
    for (let d = 0; d < DAYS_PER_WEEK; d += 1) {
      for (let s = 0; s < MEAL_SLOTS.length; s += 1) {
        if (flatIndex(w, d, s) >= limit) return false
        const cell = plan.weeks[w][d][s]
        if (!cell.leftover && cell.recipe === name) return true
      }
    }
  }

  return false
}

export function isWeekEmpty(plan, week) {
  return plan.weeks[week].every((day) => day.every((slot) => !slot.recipe))
}

export function plannedDayCount(plan, week) {
  return plan.weeks[week].filter((day) => day.some((slot) => slot.recipe)).length
}

// --- status and totals -------------------------------------------------------

// Requirement 5.3: every planned day reports either OK or the problems to fix.
function slotIssues(plan, week, day, slotIndex, preferences) {
  const slot = plan.weeks[week][day][slotIndex]
  if (!slot.recipe) return []

  const issues = []
  const recipe = findRecipe(plan, slot.recipe)

  if (!recipe) {
    issues.push(`${slot.recipe} is no longer in the recipe list`)
    return issues
  }

  for (const problem of recipeProblems(recipe, preferences)) {
    issues.push(problem.message)
  }

  if (slot.leftover && !cookedBefore(plan, week, day, slotIndex, slot.recipe)) {
    issues.push(`Cook ${slot.recipe} earlier in the plan first`)
  }

  if (slot.servings !== null && !(Number(slot.servings) >= 1)) {
    issues.push('People must be 1 or more')
  }

  return issues
}

export function dayIssues(plan, week, day, preferences) {
  return MEAL_SLOTS.flatMap((_, slotIndex) =>
    slotIssues(plan, week, day, slotIndex, preferences),
  )
}

export function dayNutrition(plan, week, day) {
  let calories = 0
  let protein = 0
  let filled = 0

  for (const slot of plan.weeks[week][day]) {
    const recipe = findRecipe(plan, slot.recipe)
    if (!recipe?.nutritionPerServing) continue
    calories += recipe.nutritionPerServing.calories ?? 0
    protein += recipe.nutritionPerServing.protein ?? 0
    filled += 1
  }

  return { calories, protein, filled }
}

// --- editing actions ---------------------------------------------------------

// Repeating a meal close to itself is exactly what the cool-off rule exists to
// prevent, so candidates are penalised by how near their other uses are. This
// keeps swaps from collapsing a whole week onto one recipe.
function varietyPenalty(weeks, week, name, day) {
  let penalty = 0

  for (let d = 0; d < DAYS_PER_WEEK; d += 1) {
    for (const slot of weeks[week][d]) {
      if (slot.leftover || slot.recipe !== name) continue
      const gap = Math.abs(d - day)
      penalty += gap <= COOL_OFF_DAYS ? 400 / (gap + 1) : 40
    }
  }

  return penalty
}

// The closest compliant stand-in for a recipe that can no longer be used.
function replacementFor(weeks, recipes, recipe, slotIndex, preferences, week, day) {
  const slot = MEAL_SLOTS[slotIndex]

  const candidates = recipes.filter(
    (option) =>
      option.name !== recipe?.name &&
      fillsSlot(option, slot) &&
      isRecipeCompliant(option, preferences),
  )
  if (!candidates.length) return null

  const target = recipe?.nutritionPerServing?.calories ?? 0
  const rank = (option) =>
    Math.abs((option.nutritionPerServing?.calories ?? 0) - target) +
    varietyPenalty(weeks, week, option.name, day)

  return [...candidates].sort((a, b) => rank(a) - rank(b))[0]
}

// The latest meal actually cooked before this slot that could fill it.
function mostRecentCooked(probe, week, day, slotIndex, preferences) {
  const slot = MEAL_SLOTS[slotIndex]

  for (let d = day; d >= 0; d -= 1) {
    const from = d === day ? slotIndex : MEAL_SLOTS.length
    for (let s = from - 1; s >= 0; s -= 1) {
      const cell = probe.weeks[week][d][s]
      if (!cell.recipe || cell.leftover) continue

      const recipe = probe.recipes.find((item) => item.name === cell.recipe)
      if (!recipe || !fillsSlot(recipe, slot)) continue
      if (!isRecipeCompliant(recipe, preferences)) continue

      return recipe.name
    }
  }

  return null
}

// Requirement 5.3: a leftover slot must reference a meal cooked earlier in the
// plan. After a swap, re-point anything orphaned at whatever did get cooked, or
// clear it when there is nothing left to reheat.
function repairLeftovers(weeks, recipes, week, preferences) {
  const probe = { weeks, recipes }

  for (let day = 0; day < DAYS_PER_WEEK; day += 1) {
    for (let slotIndex = 0; slotIndex < MEAL_SLOTS.length; slotIndex += 1) {
      const slot = weeks[week][day][slotIndex]
      if (!slot.recipe || !slot.leftover) continue

      const recipe = recipes.find((item) => item.name === slot.recipe)
      const intact =
        recipe &&
        isRecipeCompliant(recipe, preferences) &&
        cookedBefore(probe, week, day, slotIndex, slot.recipe)

      if (intact) continue

      const source = mostRecentCooked(probe, week, day, slotIndex, preferences)
      slot.recipe = source
      slot.leftover = Boolean(source)
    }
  }
}

// Requirement 5.3: when a safety-relevant preference changes, swap the meals
// that are no longer allowed and report what moved.
export function resyncWeek(plan, week, preferences) {
  const weeks = plan.weeks.map((w) =>
    w.map((day) => day.map((slot) => ({ ...slot }))),
  )
  const changes = []

  for (let day = 0; day < DAYS_PER_WEEK; day += 1) {
    for (let slotIndex = 0; slotIndex < MEAL_SLOTS.length; slotIndex += 1) {
      const slot = weeks[week][day][slotIndex]
      if (!slot.recipe || slot.leftover) continue

      const recipe = findRecipe(plan, slot.recipe)
      if (recipe && isRecipeCompliant(recipe, preferences)) continue

      const replacement = replacementFor(
        weeks,
        plan.recipes,
        recipe,
        slotIndex,
        preferences,
        week,
        day,
      )

      changes.push({ from: slot.recipe, to: replacement?.name ?? null })
      slot.recipe = replacement?.name ?? null
      slot.leftover = false
      slot.status = MEAL_STATUS.PENDING
      slot.saved = false
    }
  }

  repairLeftovers(weeks, plan.recipes, week, preferences)

  return { weeks, changes }
}

export function resyncPlan(plan, preferences) {
  let working = plan
  const changes = []

  for (let week = CURRENT_WEEK; week < WEEKS_IN_PLAN; week += 1) {
    const result = resyncWeek(working, week, preferences)
    if (!result.changes.length) continue
    working = { ...working, weeks: result.weeks }
    changes.push(...result.changes)
  }

  return { plan: working, changes }
}

// Requirement 4.3: the planned meal is the headline pick, and these are the
// alternatives offered when the user rejects it.
export function alternativesFor(plan, name, slotIndex, preferences, limit = 3) {
  const slot = MEAL_SLOTS[slotIndex]
  const current = findRecipe(plan, name)
  const target = current?.nutritionPerServing?.calories ?? 0

  const rank = (recipe) =>
    Math.abs((recipe.nutritionPerServing?.calories ?? 0) - target)

  return plan.recipes
    .filter(
      (recipe) =>
        recipe.name !== name &&
        fillsSlot(recipe, slot) &&
        isRecipeCompliant(recipe, preferences),
    )
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
}

// Requirement 5.4: the one meal that replaces `name` when the user asks for
// another. It comes from the plan's own catalog (the planner's other options
// for that meal type and the user's own recipes), skipping `excludeNames`.
export function closestAlternative(plan, name, slotIndex, preferences, excludeNames = []) {
  const candidates = alternativesFor(
    plan,
    name,
    slotIndex,
    preferences,
    plan.recipes.length,
  ).filter((recipe) => !excludeNames.includes(recipe.name))

  return candidates[0] ?? null
}

// --- dropdown options --------------------------------------------------------

export const SLOT_VALUE_EMPTY = ''
export const encodeSlotValue = (recipe, leftover) =>
  recipe ? `${leftover ? 'leftover' : 'recipe'}::${recipe}` : SLOT_VALUE_EMPTY

export function decodeSlotValue(value) {
  if (!value) return { recipe: null, leftover: false }
  const [kind, ...rest] = value.split('::')
  return { recipe: rest.join('::'), leftover: kind === 'leftover' }
}

// Every recipe that can fill this slot, plus leftovers of anything already
// cooked earlier in the plan.
export function slotOptions(plan, week, day, slotIndex, preferences) {
  // A recipe the user wrote is called out so they can find it among the rest.
  const optionLabel = (recipe) =>
    recipe.source === CUSTOM_RECIPE_SOURCE
      ? `${recipe.name} (yours)`
      : recipe.name

  const options = recipesForSlot(plan, slotIndex).map((recipe) => {
    const problems = recipeProblems(recipe, preferences)
    return {
      value: encodeSlotValue(recipe.name, false),
      label: problems.length
        ? `${optionLabel(recipe)}: ${problems[0].message}`
        : optionLabel(recipe),
      unsafe: problems.some((problem) => problem.kind === 'allergy'),
      problem: problems.length > 0,
    }
  })

  const leftovers = recipesForSlot(plan, slotIndex)
    .filter((recipe) => cookedBefore(plan, week, day, slotIndex, recipe.name))
    .map((recipe) => ({
      value: encodeSlotValue(recipe.name, true),
      label: `Leftovers: ${optionLabel(recipe)}`,
      unsafe: !isRecipeCompliant(recipe, preferences),
      problem: !isRecipeCompliant(recipe, preferences),
    }))

  return { options, leftovers }
}
