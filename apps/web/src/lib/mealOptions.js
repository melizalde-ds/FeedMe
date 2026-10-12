// Turns the live planner's answer (MealOptions, POST /api/meal-options) into
// the plan shape the Plan view already uses.
//
// MealOptions: { session_id, status, plan_days, warnings: string[],
//   meals: { breakfast|lunch|dinner|snack: MealOption[] } }   best first
// MealOption: { id, recipe_id, meal_type, day_index (null when queued), rank,
//   is_headline, status, title, image_url, cook_time_minutes, servings,
//   nutrition: { calories, protein_g, carbs_g, fat_g, ... } per serving,
//   compliance, ingredients: string[], instructions: string[] }
//
// Planner recipes carry ingredient names only, with no amounts and no prices.
// They are marked `namesOnly`, and every screen that would show an amount, a
// price or a cost leaves it out for them. Nothing missing is filled in.

import { CURRENT_WEEK, MEAL_SLOTS, WEEKS_IN_PLAN } from './constants.js'
import { allergenConflicts } from './allergySafety.js'
import { invalid } from './http.js'
import { emptySlot, emptyWeeks } from './planner.js'

const DAYS_PER_WEEK = 7
const MAX_DAYS = (WEEKS_IN_PLAN - CURRENT_WEEK) * DAYS_PER_WEEK

export const PLANNER_NUTRITION_SOURCE =
  'Per serving, as given by the recipe. An estimate, not verified'

export const isNamesOnly = (recipe) => Boolean(recipe?.namesOnly)

const numberOrNull = (value, places = 0) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const factor = 10 ** places
  return Math.round(number * factor) / factor
}

// Null when the recipe gives no calories, so no day total counts it as zero.
function nutritionOf(raw = {}) {
  const calories = numberOrNull(raw.calories)
  if (calories === null) return null
  return {
    calories,
    protein: numberOrNull(raw.protein_g, 1),
    carbs: numberOrNull(raw.carbs_g, 1),
    fat: numberOrNull(raw.fat_g, 1),
  }
}

const asStrings = (list) =>
  Array.isArray(list)
    ? list.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []

// Plan slots point at recipes by name, so names have to be unique across the
// planner's options and the user's own recipes.
function uniqueName(title, taken) {
  const base = String(title ?? '').trim() || 'Untitled recipe'
  let name = base
  for (let copy = 2; taken.has(name); copy += 1) name = `${base} (${copy})`
  taken.add(name)
  return name
}

// `dietTags` are the diet styles the planner checked this recipe against: the
// household's own at the time it asked. Recording them as tags lets the
// existing diet check (mealFilters.js) accept these recipes, and flag them
// again if a diet is added later.
function toRecipe(option, mealType, name, dietTags) {
  return {
    name,
    slots: [mealType],
    cookTimeMinutes: numberOrNull(option.cook_time_minutes),
    allergens: [],
    tags: [...dietTags],
    nutritionPerServing: nutritionOf(option.nutrition),
    nutritionSource: PLANNER_NUTRITION_SOURCE,
    ingredients: asStrings(option.ingredients).map((ingredient) => ({
      name: ingredient,
      quantity: null,
      unit: '',
      cost: null,
    })),
    instructions: asStrings(option.instructions),
    imageUrl: typeof option.image_url === 'string' && option.image_url ? option.image_url : null,
    recipeServings: numberOrNull(option.servings),
    source: 'planner',
    namesOnly: true,
    optionId: option.id ?? null,
    recipeId: option.recipe_id ?? null,
  }
}

const listOf = (items) =>
  items.length <= 3
    ? items.join(', ')
    : `${items.slice(0, 3).join(', ')} and ${items.length - 3} more`

export function planFromMealOptions(answer, preferences, customRecipes = []) {
  if (!answer || typeof answer !== 'object' || !answer.meals || typeof answer.meals !== 'object') {
    throw invalid('The planner answered with something we could not read.')
  }

  const allergies = preferences.allergies ?? []
  const dietTags = preferences.dietaryRestrictions ?? []
  const taken = new Set(customRecipes.map((recipe) => recipe.name))

  const recipes = []
  const shown = []
  const queued = new Map(MEAL_SLOTS.map((slot) => [slot, []]))
  const dropped = []

  // Snacks have no slot in the Plan view; the request asks for none.
  for (const mealType of MEAL_SLOTS) {
    const options = [...(answer.meals[mealType] ?? [])].sort(
      (a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0),
    )

    for (const option of options) {
      const recipe = toRecipe(option, mealType, uniqueName(option.title, taken), dietTags)

      // The planner checked every option, but nothing is shown before the
      // browser has checked it too. A conflict is left out and named.
      const conflicts = allergenConflicts(recipe, allergies)
      const day = Number.isInteger(option.day_index) ? option.day_index : null

      if (conflicts.length) {
        dropped.push({ name: recipe.name, conflicts, mealType, day })
        continue
      }

      recipes.push(recipe)
      if (day !== null) shown.push({ recipe, mealType, day })
      else queued.get(mealType).push(recipe)
    }
  }

  if (!recipes.length) {
    throw invalid(
      'Every meal the planner suggested mentions one of your allergies, so none are shown. Check your allergies in Setup and try again.',
    )
  }

  const weeks = emptyWeeks()
  const place = (recipe, mealType, day) => {
    if (day < 0 || day >= MAX_DAYS) return
    const absolute = CURRENT_WEEK * DAYS_PER_WEEK + day
    weeks[Math.floor(absolute / DAYS_PER_WEEK)][absolute % DAYS_PER_WEEK][
      MEAL_SLOTS.indexOf(mealType)
    ] = { ...emptySlot(), recipe: recipe.name }
  }

  for (const { recipe, mealType, day } of shown) place(recipe, mealType, day)

  // A day whose suggestion was left out gets the next queued option instead.
  for (const { mealType, day } of dropped) {
    if (day === null) continue
    const next = queued.get(mealType).shift()
    if (next) place(next, mealType, day)
  }

  const warnings = asStrings(answer.warnings)
  if (dropped.length) {
    warnings.push(
      `We left out ${listOf(dropped.map((item) => item.name))} because the ingredients mention ${listOf(
        [...new Set(dropped.flatMap((item) => item.conflicts))],
      )}, which your household avoids.`,
    )
  }

  return {
    id: answer.session_id ?? `plan-${Date.now()}`,
    sessionId: answer.session_id ?? null,
    createdAt: new Date().toISOString(),
    source: 'planner',
    planDays: Number(answer.plan_days) || null,
    recipes,
    weeks,
    confirmedWeek: null,
    warnings,
  }
}
