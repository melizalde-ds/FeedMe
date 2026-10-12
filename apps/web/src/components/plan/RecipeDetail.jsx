import { CUSTOM_RECIPE_SOURCE } from '../../lib/constants'
import { isNamesOnly } from '../../lib/mealOptions'

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

// Requirement 6, for a planner recipe: ingredient names only, no amounts, no
// prices and no cost.
function NamesOnlyRecipe({ recipe, conflicts }) {
  const nutrition = recipe.nutritionPerServing

  return (
    <div className="recipe">
      {recipe.imageUrl ? (
        <img
          src={recipe.imageUrl}
          alt=""
          loading="lazy"
          className="mb-4 aspect-[4/3] w-full max-w-md rounded-lg object-cover"
        />
      ) : null}

      <p className="recipe__meta">
        Per serving · {nutrition ? `about ${figure(nutrition.calories)} kcal` : 'no calories given'}
        {nutrition ? ` · ${figure(nutrition.protein, ' g')} protein` : ''}
        {' · '}
        {recipe.cookTimeMinutes == null
          ? 'cooking time not given'
          : `${recipe.cookTimeMinutes} min`}
        {recipe.recipeServings ? ` · the recipe makes ${recipe.recipeServings}` : ''}
      </p>

      {conflicts.length ? (
        <p className="recipe__allergens is-conflict">
          This conflicts with {conflicts.join(', ')} in your setup.
        </p>
      ) : null}

      <section className="recipe__section">
        <h3 className="recipe__heading">Nutrition per serving (estimated)</h3>
        {nutrition ? (
          <ul className="macro-list">
            <li>
              <span>{figure(nutrition.calories)}</span> kcal
            </li>
            <li>
              <span>{figure(nutrition.protein, 'g')}</span> protein
            </li>
            <li>
              <span>{figure(nutrition.carbs, 'g')}</span> carbs
            </li>
            <li>
              <span>{figure(nutrition.fat, 'g')}</span> fat
            </li>
          </ul>
        ) : (
          <p className="m-0">The recipe gives no nutrition figures.</p>
        )}
        <p className="recipe__source">Source: {recipe.nutritionSource}.</p>
      </section>

      <section className="recipe__section">
        <h3 className="recipe__heading">Ingredients</h3>
        {recipe.ingredients.length ? (
          <ul className="m-0 pl-5">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={`${ingredient.name}-${index}`}>{ingredient.name}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0">The recipe lists no ingredients.</p>
        )}
        <p className="mt-2 mb-0 text-sm text-mute">
          The recipe gives no amounts or prices, so none are shown.
        </p>
      </section>

      <section className="recipe__section">
        <h3 className="recipe__heading">
          Directions
          {recipe.cookTimeMinutes == null ? '' : ` · about ${recipe.cookTimeMinutes} min`}
        </h3>
        {recipe.instructions.length ? (
          <ol className="recipe__steps">
            {recipe.instructions.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="m-0">The recipe gives no directions.</p>
        )}
      </section>

      <p className="fine-print">
        {NAMES_ONLY_NOTE} Check the product labels yourself before cooking.
      </p>
    </div>
  )
}

// Requirement 6, for a recipe the user wrote: name, per-serving nutrition,
// cooking time, the prices they entered, flagged allergens, ingredients and
// directions, with the unverified caveat.
export function RecipeDetail({ recipe, servings, conflicts = [] }) {
  if (isNamesOnly(recipe)) {
    return <NamesOnlyRecipe recipe={recipe} conflicts={conflicts} />
  }

  const nutrition = recipe.nutritionPerServing
  const perServingCost = recipe.ingredients.reduce(
    (sum, ingredient) => sum + (ingredient.cost ?? 0),
    0,
  )

  return (
    <div className="recipe">
      <p className="recipe__meta">
        Per serving · about {nutrition.calories} kcal · {nutrition.protein} g
        protein · {recipe.cookTimeMinutes} min · about{' '}
        {money(perServingCost)} (estimates)
      </p>

      {recipe.allergens.length ? (
        <p className={conflicts.length ? 'recipe__allergens is-conflict' : 'recipe__allergens'}>
          Contains: {recipe.allergens.join(', ')}
          {conflicts.length
            ? ` — this conflicts with ${conflicts.join(', ')} in your setup.`
            : ''}
        </p>
      ) : null}

      <section className="recipe__section">
        <h3 className="recipe__heading">
          Nutrition per serving (
          {recipe.source === CUSTOM_RECIPE_SOURCE ? 'yours' : 'estimated'})
        </h3>
        <ul className="macro-list">
          <li>
            <span>{nutrition.calories}</span> kcal
          </li>
          <li>
            <span>{nutrition.protein}g</span> protein
          </li>
          <li>
            <span>{nutrition.carbs}g</span> carbs
          </li>
          <li>
            <span>{nutrition.fat}g</span> fat
          </li>
        </ul>
        <p className="recipe__source">
          Source: {recipe.nutritionSource ?? 'Estimated from recipe macros'}.
        </p>
      </section>

      <section className="recipe__section">
        <h3 className="recipe__heading">
          Ingredients for {servings} {servings === 1 ? 'serving' : 'servings'}
        </h3>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Ingredient</th>
              <th scope="col">Amount</th>
              <th scope="col">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {recipe.ingredients.map((ingredient) => (
              <tr key={`${ingredient.name}-${ingredient.unit}`}>
                <td>{ingredient.name}</td>
                <td>
                  {round(ingredient.quantity * servings)} {ingredient.unit}
                </td>
                <td>{money(round((ingredient.cost ?? 0) * servings))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan="2">
                Meal total
              </th>
              <td>{money(round(perServingCost * servings))}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="recipe__section">
        <h3 className="recipe__heading">
          Directions · about {recipe.cookTimeMinutes} min
        </h3>
        <ol className="recipe__steps">
          {recipe.instructions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <p className="fine-print">
        {SOURCE_NOTES[recipe.source] ?? UNVERIFIED_NOTE} Check the product
        labels yourself before cooking.
      </p>
    </div>
  )
}
