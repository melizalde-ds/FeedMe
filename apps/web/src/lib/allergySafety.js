// Client-side allergy gate. The backend is the primary validator, but a wrong
// answer here is a safety problem, so the frontend re-checks every recipe
// before it is shown and never silently drops a conflict.

import { COMMON_ALLERGENS } from './constants.js'

const ALLERGEN_KEYWORDS = {
  Peanuts: ['peanut'],
  'Tree nuts': [
    'almond',
    'cashew',
    'walnut',
    'pecan',
    'pistachio',
    'hazelnut',
    'macadamia',
  ],
  Milk: [
    'milk',
    'cheese',
    'butter',
    'yogurt',
    'cream',
    'parmesan',
    'whey',
    'cheddar',
  ],
  Eggs: ['egg', 'mayonnaise'],
  'Wheat/Gluten': [
    'wheat',
    'bread',
    'pasta',
    'flour',
    'tortilla',
    'penne',
    'noodle',
    'sourdough',
  ],
  Soy: ['soy', 'tofu', 'edamame', 'miso'],
  Fish: ['salmon', 'tuna', 'cod', 'tilapia', 'anchovy', 'fish'],
  Shellfish: ['shrimp', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'prawn'],
  Sesame: ['sesame', 'tahini', 'hummus'],
}

// Ingredients named after an allergen they do not actually contain.
const SAFE_EXCEPTIONS = {
  Milk: [
    'oat milk',
    'almond milk',
    'soy milk',
    'coconut milk',
    'rice milk',
    // "butter" matches Milk, but a nut or fruit butter contains none.
    'peanut butter',
    'almond butter',
    'cashew butter',
    'sunflower butter',
    'cocoa butter',
    'apple butter',
  ],
  'Tree nuts': ['coconut milk'],
  'Wheat/Gluten': ['corn tortilla', 'rice noodle'],
}

const ingredientNames = (recipe) =>
  (recipe.ingredients ?? []).map((ingredient) => ingredient.name.toLowerCase())

const searchText = (recipe) =>
  `${recipe.name} ${ingredientNames(recipe).join(' ')}`.toLowerCase()

function findDeclaredConflicts(recipe, allergies) {
  const declared = recipe.allergens ?? []
  return allergies.filter((allergy) => declared.includes(allergy))
}

function findIngredientConflicts(recipe, allergies) {
  const conflicts = []

  for (const allergy of allergies) {
    const keywords = ALLERGEN_KEYWORDS[allergy]
    if (!keywords) continue

    const exceptions = SAFE_EXCEPTIONS[allergy] ?? []
    const matches = (recipe.ingredients ?? []).filter((ingredient) => {
      const name = ingredient.name.toLowerCase()
      if (exceptions.some((exception) => name.includes(exception))) return false
      return keywords.some((keyword) => name.includes(keyword))
    })

    if (matches.length) {
      conflicts.push({
        allergy,
        ingredients: matches.map((ingredient) => ingredient.name),
      })
    }
  }

  return conflicts
}

// A user-typed allergen has no keyword table, so it is matched as plain text
// against the recipe name and every ingredient.
function findCustomConflicts(recipe, allergies) {
  const haystack = searchText(recipe)
  return allergies.filter((allergy) => {
    if (COMMON_ALLERGENS.includes(allergy)) return false
    const needle = allergy.trim().toLowerCase()
    return needle.length > 1 && haystack.includes(needle)
  })
}

// Requirement 5.8: a user writing out their own recipe will not always flag its
// allergens, so the ingredient scan is run over the recipe on its own and what
// it finds is added to the recipe's declared list. The scan is the same one the
// household gate uses, so a recipe can never declare its way past it.
export function detectedAllergens(recipe) {
  return COMMON_ALLERGENS.filter(
    (allergen) => findIngredientConflicts(recipe, [allergen]).length > 0,
  )
}

// Every allergen that bars this recipe, as labels ready to show the user.
export function allergenConflicts(recipe, allergies = []) {
  if (!allergies.length) return []

  const labels = new Set([
    ...findDeclaredConflicts(recipe, allergies),
    ...findIngredientConflicts(recipe, allergies).map(
      (conflict) => conflict.allergy,
    ),
    ...findCustomConflicts(recipe, allergies),
  ])

  return [...labels]
}
