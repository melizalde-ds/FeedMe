import { MEAL_SLOTS, MEAL_STATUS, SLOT_LABELS, WEEK_DAYS } from '../../lib/constants'
import { allergenConflicts } from '../../lib/allergySafety'
import { isCustomRecipe } from '../../lib/customRecipes'
import { alternativesFor, findRecipe, slotServings } from '../../lib/planner'
import { recipeProblems } from '../../lib/mealFilters'
import { isNamesOnly } from '../../lib/mealOptions'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { Modal } from '../common/Modal'
import { RecipeDetail } from './RecipeDetail'

// A planner recipe may lack its time or nutrition; only what it gives is shown.
function namesOnlyMeta(recipe) {
  const nutrition = recipe.nutritionPerServing
  const parts = [
    recipe.cookTimeMinutes == null ? null : `${recipe.cookTimeMinutes} min`,
    nutrition?.calories == null ? null : `${nutrition.calories} kcal`,
    nutrition?.protein == null ? null : `${nutrition.protein} g protein`,
  ].filter(Boolean)
  if (!parts.length) return 'No time or nutrition given'
  return `${parts.join(' · ')}${nutrition ? ' per serving' : ''}`
}

export function RecipeModal({ week, day, slotIndex, onClose, onEditRecipe }) {
  const { preferences } = useHousehold()
  const {
    plan,
    setSlot,
    acceptSlot,
    rejectSlot,
    toggleSavedSlot,
    requestAlternative,
    busySlot,
  } = useMealPlan()

  const slot = plan.weeks[week][day][slotIndex]
  const recipe = findRecipe(plan, slot.recipe)

  if (!recipe) return null

  const slotName = MEAL_SLOTS[slotIndex]
  const conflicts = allergenConflicts(recipe, preferences.allergies ?? [])
  const problems = recipeProblems(recipe, preferences)
  const alternatives = alternativesFor(plan, recipe.name, slotIndex, preferences)
  const servings = slotServings(slot, preferences)
  const isBusy = busySlot === `${week}-${day}-${slotIndex}`

  const title = slot.leftover ? `Leftovers: ${recipe.name}` : recipe.name

  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal__context">
        {SLOT_LABELS[slotName]} · {WEEK_DAYS[day]} of Week {week + 1} ·{' '}
        {servings} {servings === 1 ? 'serving' : 'servings'}
        {slot.leftover ? ' · reheated from an earlier meal' : ''}
      </p>

      {problems.length ? (
        <p className="alert" role="alert">
          <strong>Do not cook this as planned.</strong>{' '}
          {problems.map((problem) => problem.message).join('. ')}. Swap it for
          one of the alternatives below.
        </p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => acceptSlot(week, day, slotIndex)}
          disabled={slot.status === MEAL_STATUS.ACCEPTED}
        >
          {slot.status === MEAL_STATUS.ACCEPTED ? 'Accepted' : 'Accept this meal'}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => rejectSlot(week, day, slotIndex)}
          disabled={slot.status === MEAL_STATUS.REJECTED}
        >
          {slot.status === MEAL_STATUS.REJECTED ? 'Rejected' : 'Reject'}
        </button>
        <button
          type="button"
          className={`button${slot.saved ? ' is-active' : ''}`}
          aria-pressed={slot.saved}
          onClick={() => toggleSavedSlot(week, day, slotIndex)}
        >
          {slot.saved ? 'Saved' : 'Save this recipe'}
        </button>
        <button
          type="button"
          className="button"
          disabled={isBusy}
          onClick={() => requestAlternative(week, day, slotIndex)}
        >
          {isBusy ? 'Finding another…' : 'Suggest another'}
        </button>
        {isCustomRecipe(recipe) ? (
          <button
            type="button"
            className="button"
            onClick={() => onEditRecipe?.(recipe)}
          >
            Edit this recipe
          </button>
        ) : null}
      </div>

      {alternatives.length ? (
        <section className="modal__section">
          <h3 className="recipe__heading">Alternatives that fit your setup</h3>
          <ul className="alternatives">
            {alternatives.map((option) => (
              <li key={option.name} className="alternatives__item">
                <div>
                  <p className="alternatives__name">{option.name}</p>
                  {isNamesOnly(option) ? (
                    <p className="alternatives__meta">{namesOnlyMeta(option)}</p>
                  ) : (
                    <p className="alternatives__meta">
                      {option.cookTimeMinutes} min ·{' '}
                      {option.nutritionPerServing.calories} kcal ·{' '}
                      {option.nutritionPerServing.protein} g protein per serving
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setSlot(week, day, slotIndex, {
                      recipe: option.name,
                      leftover: false,
                    })
                    onClose()
                  }}
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="fine-print">
          No other {slotName} option fits your allergies and diet. Remake the
          plan for new ones, or relax a restriction in Setup.
        </p>
      )}

      <RecipeDetail recipe={recipe} servings={servings} conflicts={conflicts} />
    </Modal>
  )
}
