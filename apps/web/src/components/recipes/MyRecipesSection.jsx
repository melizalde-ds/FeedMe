import { useState } from 'react'
import { SLOT_LABELS } from '../../lib/constants'
import { allergenConflicts } from '../../lib/allergySafety'
import { recipeCostPerServing } from '../../lib/planner'
import { recipeProblems } from '../../lib/mealFilters'
import { useCustomRecipes } from '../../hooks/useCustomRecipes'
import { useHousehold } from '../../hooks/useHousehold'
import { Modal } from '../common/Modal'
import { RecipeDetail } from '../plan/RecipeDetail'
import { RecipeFormModal } from './RecipeFormModal'

function RecipeCard({ recipe, onView, onEdit, onDelete }) {
  const { preferences } = useHousehold()
  const [confirming, setConfirming] = useState(false)

  const conflicts = allergenConflicts(recipe, preferences.allergies ?? [])
  const problems = recipeProblems(recipe, preferences)
  const nutrition = recipe.nutritionPerServing

  return (
    <article className="plan-card">
      <h3 className="plan-card__title">{recipe.name}</h3>

      <p className="plan-card__by">
        {recipe.slots.map((slot) => SLOT_LABELS[slot]).join(' · ')} ·{' '}
        {recipe.cookTimeMinutes} min · makes {recipe.enteredFor}
      </p>

      <p className="plan-card__cost">
        Per serving: about {nutrition.calories} kcal · {nutrition.protein} g
        protein · ${recipeCostPerServing(recipe).toFixed(2)} (your numbers)
      </p>

      {recipe.allergens.length || recipe.tags.length ? (
        <p className="chip-row">
          {recipe.allergens.map((allergen) => (
            <span
              key={allergen}
              className={`chip ${
                conflicts.includes(allergen) ? 'chip--alert' : 'chip--warn'
              }`}
            >
              {allergen}
            </span>
          ))}
          {recipe.tags.map((tag) => (
            <span key={tag} className="chip chip--good">
              {tag}
            </span>
          ))}
        </p>
      ) : null}

      {problems.length ? (
        <p className="fine-print fine-print--alert">
          Your plan will not use this: {problems.map((p) => p.message).join('. ')}.
        </p>
      ) : (
        <p className="fine-print">
          Ready to use. Pick it for any meal, or remake a week to let the
          planner choose it.
        </p>
      )}

      <div className="plan-card__actions">
        <button type="button" className="button button--small" onClick={onView}>
          View
        </button>
        <button type="button" className="button button--small" onClick={onEdit}>
          Edit
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="button button--small button--accent"
              onClick={() => {
                setConfirming(false)
                onDelete()
              }}
            >
              Yes, delete
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
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
    <section className="panel" aria-labelledby="my-recipes-title">
      <h2 className="panel__title" id="my-recipes-title">
        Your recipes
      </h2>
      <p className="panel__lede">
        Add the meals you already cook, with your own ingredients, prices and
        macros. You can put them in any meal slot they fit, and their
        ingredients are added to your grocery list. The buying agent shops for
        the planner&rsquo;s recipes only.
      </p>

      {status ? (
        <p className="fieldset__summary" role="status">
          {status}
        </p>
      ) : null}

      {customRecipes.length ? (
        <div className="card-grid">
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
        <p className="fine-print">
          Nothing here yet. A recipe needs its ingredients, their amounts and
          prices, and the calories and protein for the whole dish — we divide
          those by the servings it makes.
        </p>
      )}

      <div className="panel__actions">
        <button
          type="button"
          className="button button--primary button--large"
          onClick={() => setEditing({ recipe: null })}
        >
          Add a recipe
        </button>
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
          <p className="modal__context">
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
