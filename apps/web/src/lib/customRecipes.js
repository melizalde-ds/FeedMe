// Requirement 5.8: recipes the user types in themselves, with their own
// ingredients, costs and macro values.
//
// A user writes a recipe the way it is cooked — "this makes 4" — but the rest
// of the app holds quantities, costs and macros PER SERVING so a slot can be
// scaled to whatever number of people is eating. Everything entered is divided
// by the serving count on the way in, and `enteredFor` is kept so the form can
// show the numbers back the way they were typed.
//
// Validation here is deliberately as strict as the check api.js runs over a
// planner response: a recipe the user wrote must be no less complete than one
// the AI returned, because it ends up in the same plan, the same grocery list
// and the same nutrition totals.

import {
  COMMON_ALLERGENS,
  CUSTOM_RECIPE_SOURCE,
  DEFAULT_CUSTOM_NUTRITION_SOURCE,
  MEAL_SLOTS,
} from './constants.js'
import { allergenConflicts, detectedAllergens } from './allergySafety.js'

const MAX_NAME_LENGTH = 80
const MAX_SERVINGS = 50
const MAX_COOK_MINUTES = 600

const round = (value, places) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

// '' means "not filled in", which is a different thing from 0.
const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) return NaN
  return Number(value)
}

const isBlank = (value) => String(value ?? '').trim() === ''

export const blankIngredient = () => ({
  name: '',
  quantity: '',
  unit: '',
  cost: '',
})

export const blankDraft = () => ({
  name: '',
  slots: ['dinner'],
  makesServings: '2',
  cookTimeMinutes: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  nutritionSource: '',
  tags: [],
  allergens: [],
  ingredients: [blankIngredient(), blankIngredient(), blankIngredient()],
  instructions: '',
})

// Turns a saved recipe back into the form's values, scaled up to the serving
// count it was written for.
export function draftFromRecipe(recipe) {
  const servings = Math.max(1, Number(recipe.enteredFor) || 1)
  const nutrition = recipe.nutritionPerServing ?? {}
  const detected = detectedAllergens(recipe)
  const scale = (value) => (value == null ? '' : String(round(value * servings, 2)))

  return {
    name: recipe.name,
    slots: [...(recipe.slots ?? [])],
    makesServings: String(servings),
    cookTimeMinutes: String(recipe.cookTimeMinutes ?? ''),
    calories: scale(nutrition.calories),
    protein: scale(nutrition.protein),
    carbs: scale(nutrition.carbs),
    fat: scale(nutrition.fat),
    nutritionSource:
      recipe.nutritionSource === DEFAULT_CUSTOM_NUTRITION_SOURCE
        ? ''
        : (recipe.nutritionSource ?? ''),
    tags: [...(recipe.tags ?? [])],
    // Only the allergens the user ticked are editable; the ones the ingredient
    // scan found are added again on save.
    allergens: (recipe.allergens ?? []).filter(
      (allergen) => !detected.includes(allergen),
    ),
    ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
      name: ingredient.name,
      quantity: String(round(ingredient.quantity * servings, 2)),
      unit: ingredient.unit ?? '',
      cost: ingredient.cost ? String(round(ingredient.cost * servings, 2)) : '',
    })),
    instructions: (recipe.instructions ?? []).join('\n'),
  }
}

const usedRow = (row) =>
  !isBlank(row.name) || !isBlank(row.quantity) || !isBlank(row.cost)

function validateIngredients(rows, errors) {
  const filled = rows.filter(usedRow)

  if (!filled.length) {
    errors.ingredients = 'Add at least one ingredient.'
    return []
  }

  const ingredients = []

  for (const [index, row] of filled.entries()) {
    const quantity = toNumber(row.quantity)
    const cost = isBlank(row.cost) ? 0 : toNumber(row.cost)
    const where = `Ingredient ${index + 1}`

    if (isBlank(row.name)) {
      errors.ingredients = `${where} needs a name.`
      return []
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.ingredients = `${where} needs an amount greater than 0.`
      return []
    }
    if (!Number.isFinite(cost) || cost < 0) {
      errors.ingredients = `${where} has a cost that is not a number.`
      return []
    }

    ingredients.push({
      name: row.name.trim(),
      quantity,
      unit: row.unit.trim(),
      cost,
    })
  }

  return ingredients
}

// `takenNames` is every other recipe name already in the catalog. Names are the
// identity a plan slot stores, so two recipes may not share one.
export function validateDraft(draft, { takenNames = [] } = {}) {
  const errors = {}

  const name = String(draft.name ?? '').trim()
  if (!name) {
    errors.name = 'Give the recipe a name.'
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Keep the name under ${MAX_NAME_LENGTH} characters.`
  } else if (
    takenNames.some((taken) => taken.toLowerCase() === name.toLowerCase())
  ) {
    errors.name = 'A recipe with this name already exists. Pick another name.'
  }

  const slots = MEAL_SLOTS.filter((slot) => (draft.slots ?? []).includes(slot))
  if (!slots.length) {
    errors.slots = 'Choose at least one meal this recipe can fill.'
  }

  const makesServings = toNumber(draft.makesServings)
  if (
    !Number.isInteger(makesServings) ||
    makesServings < 1 ||
    makesServings > MAX_SERVINGS
  ) {
    errors.makesServings = `How many servings does it make? Between 1 and ${MAX_SERVINGS}.`
  }

  const cookTimeMinutes = toNumber(draft.cookTimeMinutes)
  if (
    !Number.isFinite(cookTimeMinutes) ||
    cookTimeMinutes < 0 ||
    cookTimeMinutes > MAX_COOK_MINUTES
  ) {
    errors.cookTimeMinutes = `Enter a cooking time in minutes, up to ${MAX_COOK_MINUTES}.`
  }

  const calories = toNumber(draft.calories)
  if (!Number.isFinite(calories) || calories <= 0) {
    errors.calories = 'Enter the calories for the whole recipe.'
  }

  const protein = toNumber(draft.protein)
  if (!Number.isFinite(protein) || protein < 0) {
    errors.protein = 'Enter the protein in grams for the whole recipe.'
  }

  const optionalMacro = (value, key, label) => {
    if (isBlank(value)) return 0
    const parsed = toNumber(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors[key] = `Enter ${label} in grams, or leave it blank.`
      return 0
    }
    return parsed
  }

  const carbs = optionalMacro(draft.carbs, 'carbs', 'carbs')
  const fat = optionalMacro(draft.fat, 'fat', 'fat')

  const ingredients = validateIngredients(draft.ingredients ?? [], errors)

  const instructions = String(draft.instructions ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!instructions.length) {
    errors.instructions = 'Write at least one step, one per line.'
  }

  if (Object.keys(errors).length) return { errors, recipe: null }

  const perServing = (value, places = 2) => round(value / makesServings, places)

  const base = {
    name,
    slots,
    cookTimeMinutes,
    tags: (draft.tags ?? []).slice(),
    nutritionPerServing: {
      calories: perServing(calories, 0),
      protein: perServing(protein, 1),
      carbs: perServing(carbs, 1),
      fat: perServing(fat, 1),
    },
    nutritionSource:
      String(draft.nutritionSource ?? '').trim() ||
      DEFAULT_CUSTOM_NUTRITION_SOURCE,
    ingredients: ingredients.map((ingredient) => ({
      ...ingredient,
      quantity: perServing(ingredient.quantity, 3),
      cost: perServing(ingredient.cost, 3),
    })),
    instructions,
    source: CUSTOM_RECIPE_SOURCE,
    enteredFor: makesServings,
  }

  return {
    errors,
    recipe: {
      ...base,
      // The ingredient scan is authoritative: whatever it reads is flagged
      // whether or not the user ticked it.
      allergens: [
        ...new Set([
          ...COMMON_ALLERGENS.filter((allergen) =>
            (draft.allergens ?? []).includes(allergen),
          ),
          ...detectedAllergens(base),
        ]),
      ],
    },
  }
}

// A dietary tag is the user's own claim, and the plan filters on it, so a claim
// the ingredients contradict is worth saying out loud.
const TAG_FORBIDDEN_ALLERGENS = {
  Vegan: ['Milk', 'Eggs', 'Fish', 'Shellfish'],
  Vegetarian: ['Fish', 'Shellfish'],
  Pescatarian: [],
  'Dairy-free': ['Milk'],
  'Gluten-free': ['Wheat/Gluten'],
}

// Things worth telling the user about a recipe that is otherwise valid. None of
// these block a save: they are all cases where the user may know better than
// the ingredient scan does.
export function recipeWarnings(recipe, preferences) {
  if (!recipe) return []

  const warnings = []
  const detected = detectedAllergens(recipe)

  if (detected.length) {
    warnings.push(
      `We read ${detected.join(', ')} in these ingredients, so the recipe is flagged for ${
        detected.length === 1 ? 'that allergen' : 'those allergens'
      }. Rename an ingredient if that is wrong.`,
    )
  }

  for (const tag of recipe.tags ?? []) {
    const clashes = (TAG_FORBIDDEN_ALLERGENS[tag] ?? []).filter((allergen) =>
      detected.includes(allergen),
    )
    if (clashes.length) {
      warnings.push(
        `You marked this ${tag}, but we read ${clashes.join(', ')} in the ingredients. Fix the tag or the ingredient names before you rely on it.`,
      )
    }
  }

  const conflicts = allergenConflicts(recipe, preferences?.allergies ?? [])
  if (conflicts.length) {
    warnings.push(
      `This contains ${conflicts.join(', ')}, which your household avoids, so your plans will not use it.`,
    )
  }

  const missing = (preferences?.dietaryRestrictions ?? []).filter(
    (restriction) => !(recipe.tags ?? []).includes(restriction),
  )
  if (missing.length) {
    warnings.push(
      `Your setup asks for ${missing.join(', ')}. Tick ${
        missing.length === 1 ? 'that' : 'those'
      } above if this recipe fits, or your plans will skip it.`,
    )
  }

  return warnings
}

// Custom recipes sit in their own store, so they are layered over whatever
// catalog the plan was built with. A custom recipe wins a name clash because it
// is the one the user is still editing.
export function mergeCustomRecipes(catalog = [], customRecipes = []) {
  if (!customRecipes.length) return catalog

  const byName = new Map(catalog.map((recipe) => [recipe.name, recipe]))
  for (const recipe of customRecipes) byName.set(recipe.name, recipe)
  return [...byName.values()]
}

export const withoutCustomRecipes = (catalog = []) =>
  catalog.filter((recipe) => recipe.source !== CUSTOM_RECIPE_SOURCE)

export const isCustomRecipe = (recipe) =>
  recipe?.source === CUSTOM_RECIPE_SOURCE
