// The user's Setup: how it maps to and from the backend's preferences,
// allergies and nutrition goals, and the checks the database would otherwise
// reject it with.
//
// Setup is the DEFAULT_PREFERENCES shape plus the fields below. The screens
// and safety checks read the derived `allergies` and `foodPreferences`:
//
//   allergenIds        common allergens, by backend id ('milk', 'tree_nut')
//   customAllergies    other allergens, as cleaned short terms
//   allergies          DERIVED: the labels the client-side allergy check uses
//   likedFoods         short terms
//   dislikedFoods      short terms
//   foodPreferences    DERIVED: the old free-text field, rebuilt from the lists
//   otherDietStyles    diet styles from the account the form has no box for
//   likedCuisines, dislikedCuisines, mealsPerDay   kept as the account has them
//   nutritionGoals     { calories, protein, carbs, fat }

import {
  COOKING_TIME_OPTIONS,
  DEFAULT_PREFERENCES,
  DIETARY_RESTRICTIONS,
  PLANNING_PERIOD_OPTIONS,
} from './constants.js'

const DAYS_PER_WEEK = 7

export const SAVE_UNAVAILABLE_MESSAGE =
  'Saving to your account is not available right now. Your setup is kept in this browser; try saving again in a moment.'

// --- short terms ---------------------------------------------------------------

// The same rules the database applies to custom allergens and the preference
// lists. It also rejects some instruction-like words; its message for those
// is shown as it comes.
export const TERM_RULES =
  '2 to 40 characters, at most 4 words, using letters, numbers, spaces and \' & -'

export const MAX_TERMS = 30

export const normalizeTerm = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

// null when the term is fine, otherwise the reason, ready to show.
export function termProblem(value) {
  const term = normalizeTerm(value)
  if (term.length < 2) return 'Use at least 2 characters.'
  if (term.length > 40) return 'Use 40 characters or fewer.'
  if (!/^[a-z0-9][a-z0-9 '&-]*[a-z0-9]$/.test(term)) {
    return "Use only letters, numbers, spaces, ' & and -, starting and ending with a letter or number."
  }
  if (term.split(' ').length > 4) return 'Use 4 words or fewer.'
  return null
}

// --- allergens -------------------------------------------------------------------

// Backend allergen ids to the labels the client-side allergy check knows
// (allergySafety.js). Wheat and gluten both map to its one wheat/gluten group,
// which is the stricter reading.
const LOCAL_LABEL_FOR_ALLERGEN = {
  milk: 'Milk',
  egg: 'Eggs',
  peanut: 'Peanuts',
  tree_nut: 'Tree nuts',
  wheat: 'Wheat/Gluten',
  gluten: 'Wheat/Gluten',
  soy: 'Soy',
  fish: 'Fish',
  shellfish: 'Shellfish',
  sesame: 'Sesame',
}

// Only used when GET /api/allergens can't be reached, so the form stays
// usable. Mirrors the seed in supabase/schema.sql.
export const FALLBACK_ALLERGEN_OPTIONS = [
  { id: 'milk', label: 'Milk / dairy' },
  { id: 'egg', label: 'Eggs' },
  { id: 'peanut', label: 'Peanuts' },
  { id: 'tree_nut', label: 'Tree nuts' },
  { id: 'wheat', label: 'Wheat' },
  { id: 'gluten', label: 'Gluten' },
  { id: 'soy', label: 'Soy' },
  { id: 'fish', label: 'Fish' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'sesame', label: 'Sesame' },
]

// An id this build doesn't know is checked as plain text, like a custom one.
const localLabelFor = (id) =>
  LOCAL_LABEL_FOR_ALLERGEN[id] ?? String(id).replace(/_/g, ' ')

const unique = (items) => [...new Set(items)]

export const allergyLabels = (allergenIds = [], customAllergies = []) =>
  unique([...allergenIds.map(localLabelFor), ...customAllergies])

export function splitSavedAllergies(list = []) {
  return {
    allergenIds: list
      .filter((item) => item.kind === 'common')
      .map((item) => item.allergen),
    customAllergies: list
      .filter((item) => item.kind !== 'common')
      .map((item) => normalizeTerm(item.allergen ?? item.label)),
  }
}

// What is ticked locally but not yet on the account.
export function pendingAllergies(preferences, saved) {
  const savedIds = new Set(saved.allergenIds)
  const savedCustom = new Set(saved.customAllergies)
  return {
    allergenIds: (preferences.allergenIds ?? []).filter((id) => !savedIds.has(id)),
    customAllergies: (preferences.customAllergies ?? []).filter(
      (name) => !savedCustom.has(normalizeTerm(name)),
    ),
  }
}

// --- food preferences ----------------------------------------------------------

// The plan checks read one text field (mealFilters.js), where "no x" means
// avoid. It is rebuilt from the two lists.
export const foodPreferencesText = (liked = [], disliked = []) =>
  [...liked, ...disliked.map((term) => `no ${term}`)].join(', ')

// Fills the derived fields of a Setup.
export function withDerivedFields(preferences) {
  return {
    ...preferences,
    allergies: allergyLabels(preferences.allergenIds, preferences.customAllergies),
    foodPreferences: foodPreferencesText(
      preferences.likedFoods,
      preferences.dislikedFoods,
    ),
  }
}

// --- nutrition goals -----------------------------------------------------------

export const MIN_CALORIES = 1200
export const MACRO_TOLERANCE = 0.1

// The standard split of the calories left after protein: carbs and fat in
// the ratio 50 : 30, the middle of the usual ranges for an adult (about half
// of all calories from carbs and 30% from fat).
const CARB_SHARE_OF_REST = 50 / 80

export function splitMacros(calories, protein) {
  const rest = Math.max(0, (Number(calories) || 0) - (Number(protein) || 0) * 4)
  return {
    carbs: Math.round((rest * CARB_SHARE_OF_REST) / 4),
    fat: Math.round((rest * (1 - CARB_SHARE_OF_REST)) / 9),
  }
}

export const macroCalories = ({ protein, carbs, fat }) =>
  (Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9

const isWholeNumber = (value) =>
  value !== '' && value !== null && value !== undefined && Number.isInteger(Number(value))

// Field name -> message. Empty when the database would accept the goals.
export function nutritionGoalProblems(goals = {}) {
  const problems = {}
  const calories = Number(goals.calories)

  if (!isWholeNumber(goals.calories)) {
    problems.calories = 'Enter the daily calories as a whole number.'
  } else if (calories < MIN_CALORIES) {
    problems.calories = `Use at least ${MIN_CALORIES} kcal a day.`
  }

  for (const [key, label] of [
    ['protein', 'protein'],
    ['carbs', 'carbs'],
    ['fat', 'fat'],
  ]) {
    if (!isWholeNumber(goals[key]) || Number(goals[key]) < 0) {
      problems[key] = `Enter the ${label} in whole grams, 0 or more.`
    }
  }

  if (!Object.keys(problems).length) {
    const fromMacros = macroCalories(goals)
    if (Math.abs(fromMacros - calories) > calories * MACRO_TOLERANCE) {
      problems.macros = `Protein, carbs and fat add up to ${fromMacros.toLocaleString()} kcal, which is more than 10% away from your ${calories.toLocaleString()} kcal target. Adjust a number, or recalculate carbs and fat.`
    }
  }

  return problems
}

// Every problem in an account's Setup that would stop it saving.
export function accountSetupProblems(preferences) {
  const problems = { ...nutritionGoalProblems(preferences.nutritionGoals) }

  const size = Number(preferences.householdSize)
  if (!Number.isInteger(size) || size < 1 || size > 20) {
    problems.householdSize = 'Enter between 1 and 20 people.'
  }

  for (const key of ['likedFoods', 'dislikedFoods']) {
    if ((preferences[key] ?? []).length > MAX_TERMS) {
      problems[key] = `Keep it to ${MAX_TERMS} foods or fewer.`
    }
  }

  return problems
}

// --- defaults --------------------------------------------------------------------

export function accountDefaults(saved = { allergenIds: [], customAllergies: [] }) {
  const { calories, protein } = DEFAULT_PREFERENCES.nutritionGoals
  return withDerivedFields({
    ...DEFAULT_PREFERENCES,
    allergenIds: [...saved.allergenIds],
    customAllergies: [...saved.customAllergies],
    likedFoods: [],
    dislikedFoods: [],
    otherDietStyles: [],
    likedCuisines: [],
    dislikedCuisines: [],
    mealsPerDay: 3,
    nutritionGoals: { calories, protein, ...splitMacros(calories, protein) },
  })
}

// --- to and from the backend --------------------------------------------------------

const round2 = (value) => Math.round(value * 100) / 100

const nearestOption = (options, value) =>
  options.reduce((best, option) =>
    Math.abs(option.value - value) < Math.abs(best.value - value) ? option : best,
  ).value

const dietKey = (style) => String(style).toLowerCase().replace(/[\s-]+/g, ' ').trim()

// The local budget covers the planning period; the backend's is weekly.
export function toServerPreferences(preferences) {
  const days = Number(preferences.planningPeriod) || DAYS_PER_WEEK
  const budget = Number(preferences.budget) || 0
  const cookingTime = Number(preferences.cookingTime) || 0

  return {
    diet_styles: [
      ...(preferences.dietaryRestrictions ?? []).map((style) => style.toLowerCase()),
      ...(preferences.otherDietStyles ?? []),
    ],
    liked_foods: preferences.likedFoods ?? [],
    disliked_foods: preferences.dislikedFoods ?? [],
    liked_cuisines: preferences.likedCuisines ?? [],
    disliked_cuisines: preferences.dislikedCuisines ?? [],
    household_size: Math.min(20, Math.max(1, Number(preferences.householdSize) || 1)),
    weekly_budget: budget > 0 ? round2((budget / days) * DAYS_PER_WEEK) : null,
    max_cook_time_minutes: cookingTime > 0 ? cookingTime : null,
    plan_days: Math.min(31, Math.max(1, days)),
    meals_per_day: Number(preferences.mealsPerDay) || 3,
  }
}

// The fields of a local Setup that a saved Preferences row replaces.
export function fromServerPreferences(row) {
  const known = []
  const other = []
  for (const style of row.diet_styles ?? []) {
    const match = DIETARY_RESTRICTIONS.find(
      (restriction) => dietKey(restriction) === dietKey(style),
    )
    if (match) known.push(match)
    else other.push(style)
  }

  const planningPeriod = nearestOption(PLANNING_PERIOD_OPTIONS, Number(row.plan_days) || 7)

  // The smallest offered limit that still allows the saved one.
  const limit = Number(row.max_cook_time_minutes) || 0
  const cookingTime = limit
    ? (COOKING_TIME_OPTIONS.filter((option) => option.value >= limit)
        .map((option) => option.value)
        .sort((a, b) => a - b)
        .find((value) => value > 0) ?? 0)
    : 0

  return {
    dietaryRestrictions: unique(known),
    otherDietStyles: unique(other),
    likedFoods: row.liked_foods ?? [],
    dislikedFoods: row.disliked_foods ?? [],
    likedCuisines: row.liked_cuisines ?? [],
    dislikedCuisines: row.disliked_cuisines ?? [],
    householdSize: Number(row.household_size) || 1,
    budget:
      row.weekly_budget == null
        ? 0
        : round2((Number(row.weekly_budget) / DAYS_PER_WEEK) * planningPeriod),
    cookingTime,
    planningPeriod,
    mealsPerDay: Number(row.meals_per_day) || 3,
  }
}

export const toServerGoals = (goals) => ({
  calories: Number(goals.calories),
  protein_g: Number(goals.protein),
  carbs_g: Number(goals.carbs),
  fat_g: Number(goals.fat),
})

export const fromServerGoals = (row) => ({
  calories: row.calories,
  protein: row.protein_g,
  carbs: row.carbs_g,
  fat: row.fat_g,
})
