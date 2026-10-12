import { useState } from 'react'
import { SLOT_LABELS } from '../../lib/constants'
import { allergenConflicts } from '../../lib/allergySafety'
import { recipeCostPerServing } from '../../lib/planner'
import { recipeProblems } from '../../lib/mealFilters'
import { useCustomRecipes } from '../../hooks/useCustomRecipes'
import { useHousehold } from '../../hooks/useHousehold'
import { Modal } from '../common/Modal'
import { RecipeDetail } from '../plan/RecipeDetail'
import { Button } from '../ui/Button'
import { Alert, Check, Plus } from '../ui/icons'
import { RecipeFormModal } from './RecipeFormModal'

// One recipe as a row: what it is, whether the plan can use it, and what you
// can do with it.
function RecipeCard({ recipe, onView, onEdit, onDelete }) {
  const { preferences } = useHousehold()
  const [confirming, setConfirming] = useState(false)

  const conflicts = allergenConflicts(recipe, preferences.allergies ?? [])
  const problems = recipeProblems(recipe, preferences)
  const nutrition = recipe.nutritionPerServing

  return (
    <article className="grid gap-x-8 gap-y-3 border-b border-line py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0">
        <h3 className="text-lg font-bold tracking-tight">{recipe.name}</h3>

        <p className="mt-0.5 text-sm text-mute">
          {recipe.slots.map((slot) => SLOT_LABELS[slot]).join(', ')},{' '}
          {recipe.cookTimeMinutes} min, makes {recipe.enteredFor}
        </p>

        <p className="text-sm text-mute">
          Per serving: about {nutrition.calories} kcal, {nutrition.protein} g
          protein, ${recipeCostPerServing(recipe).toFixed(2)} (your numbers)
        </p>

        {recipe.allergens.length ? (
          <p className={conflicts.length ? 'mt-2 font-bold text-danger' : 'mt-2 font-semibold'}>
            Contains {recipe.allergens.join(', ')}
          </p>
        ) : null}
        {recipe.tags.length ? (
          <p className="mt-1 text-sm text-mute">Fits: {recipe.tags.join(', ')}</p>
        ) : null}

        {problems.length ? (
          <p className="mt-2 flex gap-2 text-sm font-semibold text-danger">
            <Alert size={14} className="mt-0.75 shrink-0" />
            <span>Your plan will not use this: {problems.map((p) => p.message).join('. ')}.</span>
          </p>
        ) : (
          <p className="mt-2 flex gap-2 text-sm text-mute">
            <Check size={14} className="mt-0.75 shrink-0 text-ok" />
            <span>
              Ready to use. Pick it for any meal, or remake a week to let the
              planner choose it.
            </span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onView}>
          View
        </Button>
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirming(false)
                onDelete()
              }}
            >
              Yes, delete
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
    </article>
  )
}

// Requirement 5.8: the user's own recipe book. Anything here is offered for
// every matching meal slot and can be picked by the generator, with the same
// allergy and diet checks as every other recipe.
export function MyRecipesSection() {
  const { preferences } = useHousehold()
  const { customRecipes, deleteRecipe } = useCustomRecipes()

  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [status, setStatus] = useState('')

  const servings = Math.max(1, Number(preferences.householdSize) || 1)
  const viewingRecipe = customRecipes.find((recipe) => recipe.name === viewing)

  return (
    <section className="mt-14 border-t border-line pt-8" aria-labelledby="my-recipes-title">
      <h2 className="text-2xl font-extrabold tracking-tight" id="my-recipes-title">
        Your recipes
      </h2>
      <p className="mt-2 max-w-[58ch] text-mute">
        Add the meals you already cook, with your own ingredients, prices and
        macros. You can put them in any meal slot they fit, and their
        ingredients are added to your grocery list. The buying agent shops for
        the planner&rsquo;s recipes only.
      </p>

      {status ? (
        <p className="mt-4 flex max-w-[58ch] gap-2 font-semibold" role="status">
          <Check className="mt-1 shrink-0 text-ok" />
          <span>{status}</span>
        </p>
      ) : null}

      {customRecipes.length ? (
        <div className="mt-5 border-t border-line">
          {customRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.name}
              recipe={recipe}
              onView={() => setViewing(recipe.name)}
              onEdit={() => setEditing({ recipe })}
              onDelete={() => {
                deleteRecipe(recipe.name)
                setStatus(
                  `Deleted ${recipe.name}. Any meal in your plan that used it was swapped for the closest match that fits your setup.`,
                )
              }}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 max-w-[58ch] text-mute">
          Nothing here yet. A recipe needs its ingredients, their amounts and
          prices, and the calories and protein for the whole dish. We divide
          those by the servings it makes.
        </p>
      )}

      <div className="mt-5">
        <Button onClick={() => setEditing({ recipe: null })}>
          <Plus size={14} /> Add a recipe
        </Button>
      </div>

      {editing ? (
        <RecipeFormModal
          recipe={editing.recipe}
          onClose={() => setEditing(null)}
          onSaved={(saved, { isNew }) =>
            setStatus(
              isNew
                ? `Saved ${saved.name}. It is now in every meal dropdown it fits, and the planner can choose it when you remake a week.`
                : `Updated ${saved.name}. Your plan and grocery list use the new numbers.`,
            )
          }
        />
      ) : null}

      {viewingRecipe ? (
        <Modal title={viewingRecipe.name} onClose={() => setViewing(null)}>
          <p className="mb-3">
            Your recipe, scaled to {servings}{' '}
            {servings === 1 ? 'serving' : 'servings'}.
          </p>
          <RecipeDetail
            recipe={viewingRecipe}
            servings={servings}
            conflicts={allergenConflicts(
              viewingRecipe,
              preferences.allergies ?? [],
            )}
          />
        </Modal>
      ) : null}
    </section>
  )
}
