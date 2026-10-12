// Diet and taste checks. Allergies are handled separately in
// allergySafety.js because they are never relaxed to widen the recipe pool.

import { allergenConflicts } from './allergySafety.js'

// Each selected restriction must be named in the recipe's tags.
export function matchesDiet(recipe, dietaryRestrictions = []) {
  return dietaryRestrictions.every((restriction) =>
    (recipe.tags ?? []).includes(restriction),
  )
}

export function fillsSlot(recipe, slot) {
  return (recipe.slots ?? []).includes(slot)
}

// Splits the free-text taste field into foods to avoid and foods to favour.
// "no mushrooms, lots of chicken" -> { avoid: ['mushroom'], prefer: ['chicken'] }
function parseFoodPreferences(foodPreferences = '') {
  const avoid = []
  const prefer = []

  for (const raw of String(foodPreferences).split(/[,\n;]+/)) {
    const phrase = raw.trim().toLowerCase()
    if (!phrase) continue

    const negated = phrase.match(
      /^(?:no|not|avoid|without|hate|hates|dislike|dislikes|don'?t like|skip)\s+(.+)$/,
    )

    if (negated) {
      avoid.push(singular(negated[1]))
    } else {
      prefer.push(
        singular(
          phrase.replace(
            /^(?:lots of|lot of|more|extra|love|loves|i love|prefer|prefers)\s+/,
            '',
          ),
        ),
      )
    }
  }

  return { avoid: avoid.filter(Boolean), prefer: prefer.filter(Boolean) }
}

const singular = (word) => word.trim().replace(/s$/, '')

const recipeText = (recipe) =>
  `${recipe.name} ${(recipe.ingredients ?? [])
    .map((ingredient) => ingredient.name)
    .join(' ')}`.toLowerCase()

function avoidedFoods(recipe, foodPreferences) {
  const { avoid } = parseFoodPreferences(foodPreferences)
  const haystack = recipeText(recipe)
  return avoid.filter((term) => term.length > 1 && haystack.includes(term))
}

// Every reason this recipe does not belong in the user's plan. An empty list
// means the recipe is safe and compliant.
export function recipeProblems(recipe, preferences) {
  const problems = []

  const allergens = allergenConflicts(recipe, preferences.allergies ?? [])
  if (allergens.length) {
    problems.push({
      kind: 'allergy',
      message: `Contains ${allergens.join(', ')}`,
    })
  }

  if (!matchesDiet(recipe, preferences.dietaryRestrictions ?? [])) {
    const missing = (preferences.dietaryRestrictions ?? []).filter(
      (restriction) => !(recipe.tags ?? []).includes(restriction),
    )
    problems.push({
      kind: 'diet',
      message: `Not ${missing.join(' or ').toLowerCase()}`,
    })
  }

  const avoided = avoidedFoods(recipe, preferences.foodPreferences)
  if (avoided.length) {
    problems.push({
      kind: 'avoided',
      message: `Has ${avoided.join(', ')}, which you avoid`,
    })
  }

  return problems
}

// Safe and compliant. The cooking-time limit is the planner's to apply.
export function isRecipeCompliant(recipe, preferences) {
  return recipeProblems(recipe, preferences).length === 0
}
