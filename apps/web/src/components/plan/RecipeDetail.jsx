import { CUSTOM_RECIPE_SOURCE } from '../../lib/constants'
import { isNamesOnly } from '../../lib/mealOptions'
import { Alert } from '../ui/icons'
import { tableClass, tdClass, tfootClass, thClass } from '../ui/table'

const money = (value) => (value == null ? '—' : `$${Number(value).toFixed(2)}`)
const round = (value) => Math.round(value * 100) / 100

// Requirement 6: the reader has to be able to tell whose numbers these are.
const SOURCE_NOTES = {
  [CUSTOM_RECIPE_SOURCE]:
    'Your own recipe. The nutrition, allergens and prices are the values you entered and have not been verified.',
}

const UNVERIFIED_NOTE =
  'Nutrition, allergens and prices on this recipe have not been verified.'

const NAMES_ONLY_NOTE =
  'Chosen by the FeedMe planner and checked against your allergies and diet. Nutrition is per serving as the recipe gives it, an estimate that is not verified. The recipe has no amounts or prices.'

// A figure the recipe doesn't give stays blank: nothing is filled in.
const figure = (value, unit = '') => (value == null ? '—' : `${value}${unit}`)

const headingClass = 'mt-6 mb-2 text-base font-bold'
const fineClass = 'text-sm text-mute'

function Macros({ nutrition }) {
  const items = [
    [figure(nutrition.calories), 'kcal'],
    [figure(nutrition.protein, ' g'), 'protein'],
    [figure(nutrition.carbs, ' g'), 'carbs'],
    [figure(nutrition.fat, ' g'), 'fat'],
  ]
  return (
    <ul className="flex flex-wrap gap-x-8 gap-y-2">
      {items.map(([value, name]) => (
        <li key={name} className={fineClass}>
          <span className="block text-xl font-bold tracking-tight text-ink">{value}</span> {name}
        </li>
      ))}
    </ul>
  )
}

function Conflict({ children }) {
  return (
    <p className="mt-3 flex gap-2 font-bold text-danger">
      <Alert className="mt-1 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// Requirement 6, for a planner recipe: ingredient names only, no amounts, no
// prices and no cost.
function NamesOnlyRecipe({ recipe, conflicts, Heading }) {
  const nutrition = recipe.nutritionPerServing

  return (
    <div>
      <p className={fineClass}>
        Per serving · {nutrition ? `about ${figure(nutrition.calories)} kcal` : 'no calories given'}
        {nutrition ? ` · ${figure(nutrition.protein, ' g')} protein` : ''}
        {' · '}
        {recipe.cookTimeMinutes == null
          ? 'cooking time not given'
          : `${recipe.cookTimeMinutes} min`}
        {recipe.recipeServings ? ` · the recipe makes ${recipe.recipeServings}` : ''}
      </p>

      {conflicts.length ? (
        <Conflict>This conflicts with {conflicts.join(', ')} in your setup.</Conflict>
      ) : null}

      <Heading className={headingClass}>Nutrition per serving (estimated)</Heading>
      {nutrition ? <Macros nutrition={nutrition} /> : <p>The recipe gives no nutrition figures.</p>}
      <p className={`mt-2 ${fineClass}`}>Source: {recipe.nutritionSource}.</p>

      <Heading className={headingClass}>Ingredients</Heading>
      {recipe.ingredients.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {recipe.ingredients.map((ingredient, index) => (
            <li
              key={`${ingredient.name}-${index}`}
              className="rounded-flag border border-line bg-ground px-2.5 py-0.5 text-ui"
            >
              {ingredient.name}
            </li>
          ))}
        </ul>
      ) : (
        <p>The recipe lists no ingredients.</p>
      )}
      <p className={`mt-2 ${fineClass}`}>
        The recipe gives no amounts or prices, so none are shown.
      </p>

      <Heading className={headingClass}>
        Directions
        {recipe.cookTimeMinutes == null ? '' : ` · about ${recipe.cookTimeMinutes} min`}
      </Heading>
      {recipe.instructions.length ? (
        <ol className="max-w-[58ch] list-decimal space-y-1.5 pl-6 marker:font-bold marker:text-mute">
          {recipe.instructions.map((step, index) => (
            <li key={`${index}-${step}`}>{step}</li>
          ))}
        </ol>
      ) : (
        <p>The recipe gives no directions.</p>
      )}

      <p className={`mt-6 max-w-[58ch] ${fineClass}`}>
        {NAMES_ONLY_NOTE} Check the product labels yourself before cooking.
      </p>
    </div>
  )
}

// Requirement 6, for a recipe the user wrote: name, per-serving nutrition,
// cooking time, the prices they entered, flagged allergens, ingredients and
// directions, with the unverified caveat. `heading` is the level its section
// headings take, so they sit under whatever titles the recipe.
export function RecipeDetail({ recipe, servings, conflicts = [], heading: Heading = 'h3' }) {
  if (isNamesOnly(recipe)) {
    return <NamesOnlyRecipe recipe={recipe} conflicts={conflicts} Heading={Heading} />
  }

  const nutrition = recipe.nutritionPerServing
  const perServingCost = recipe.ingredients.reduce(
    (sum, ingredient) => sum + (ingredient.cost ?? 0),
    0,
  )

  return (
    <div>
      <p className={fineClass}>
        Per serving · about {nutrition.calories} kcal · {nutrition.protein} g
        protein · {recipe.cookTimeMinutes} min · about{' '}
        {money(perServingCost)} (estimates)
      </p>

      {recipe.allergens.length ? (
        conflicts.length ? (
          <Conflict>
            Contains: {recipe.allergens.join(', ')}. This conflicts with {conflicts.join(', ')} in
            your setup.
          </Conflict>
        ) : (
          <p className="mt-3 font-bold">Contains: {recipe.allergens.join(', ')}</p>
        )
      ) : null}

      <Heading className={headingClass}>
        Nutrition per serving (
        {recipe.source === CUSTOM_RECIPE_SOURCE ? 'yours' : 'estimated'})
      </Heading>
      <Macros nutrition={nutrition} />
      <p className={`mt-2 ${fineClass}`}>
        Source: {recipe.nutritionSource ?? 'Estimated from recipe macros'}.
      </p>

      <Heading className={headingClass}>
        Ingredients for {servings} {servings === 1 ? 'serving' : 'servings'}
      </Heading>
      <table className={`${tableClass} max-w-xl`}>
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              Ingredient
            </th>
            <th scope="col" className={thClass}>
              Amount
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Est. cost
            </th>
          </tr>
        </thead>
        <tbody>
          {recipe.ingredients.map((ingredient) => (
            <tr key={`${ingredient.name}-${ingredient.unit}`}>
              <td className={tdClass}>{ingredient.name}</td>
              <td className={tdClass}>
                {round(ingredient.quantity * servings)} {ingredient.unit}
              </td>
              <td className={`${tdClass} text-right`}>
                {money(round((ingredient.cost ?? 0) * servings))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan="2" className={tfootClass}>
              Meal total
            </th>
            <td className={`${tfootClass} text-right`}>{money(round(perServingCost * servings))}</td>
          </tr>
        </tfoot>
      </table>

      <Heading className={headingClass}>Directions · about {recipe.cookTimeMinutes} min</Heading>
      <ol className="max-w-[58ch] list-decimal space-y-1.5 pl-6 marker:font-bold marker:text-mute">
        {recipe.instructions.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <p className={`mt-6 max-w-[58ch] ${fineClass}`}>
        {SOURCE_NOTES[recipe.source] ?? UNVERIFIED_NOTE} Check the product
        labels yourself before cooking.
      </p>
    </div>
  )
}
