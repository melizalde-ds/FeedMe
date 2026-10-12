import { useEffect, useRef } from 'react'
import { MEAL_SLOTS, MEAL_STATUS, SLOT_LABELS, WEEK_DAYS } from '../../lib/constants'
import { allergenConflicts } from '../../lib/allergySafety'
import { isCustomRecipe } from '../../lib/customRecipes'
import { alternativesFor, findRecipe, slotServings } from '../../lib/planner'
import { recipeProblems } from '../../lib/mealFilters'
import { isNamesOnly } from '../../lib/mealOptions'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { Banner } from '../common/Banner'
import { Button, IconButton } from '../ui/Button'
import { Close } from '../ui/icons'
import { RecipeDetail } from './RecipeDetail'
import { SlotPicker } from './SlotPicker'

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

// One meal, unfolded under the rail it belongs to: its recipe, what you can
// do with it, and the alternatives beside it as pictures. It is part of the
// page, not a dialog over it. Focus moves in when it opens and back to the
// meal it was opened from when it closes; Escape closes it.
export function RecipeShelf({ week, day, slotIndex, onClose, onEditRecipe }) {
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

  const shelf = useRef(null)
  const opener = useRef(null)

  useEffect(() => {
    // The meal this was opened from. Not the shelf itself, which already has
    // focus when React re-runs this effect in development.
    if (!shelf.current?.contains(document.activeElement)) opener.current = document.activeElement
    const onKeyDown = (event) => {
      // A dialog on top (the recipe form) handles its own Escape.
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Hand focus back only if it was left with nowhere to go: opening
      // another meal has already put it on that meal.
      const stranded = !document.activeElement || document.activeElement === document.body
      if (stranded && opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }
  }, [onClose])

  // Opening another meal moves the shelf: bring it into view and take focus.
  useEffect(() => {
    shelf.current?.focus({ preventScroll: true })
    shelf.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [day, slotIndex])

  const slot = plan.weeks[week][day][slotIndex]
  const recipe = findRecipe(plan, slot.recipe)
  const slotName = MEAL_SLOTS[slotIndex]
  const servings = slotServings(slot, preferences)
  const isBusy = busySlot === `${week}-${day}-${slotIndex}`

  const conflicts = recipe ? allergenConflicts(recipe, preferences.allergies ?? []) : []
  const problems = recipe ? recipeProblems(recipe, preferences) : []
  const alternatives = recipe ? alternativesFor(plan, recipe.name, slotIndex, preferences) : []

  const title = recipe
    ? slot.leftover
      ? `Leftovers: ${recipe.name}`
      : recipe.name
    : slot.recipe || `Choose a ${slotName}`

  return (
    <section
      className="unfold col-span-full mt-3.5 scroll-mt-6 rounded-panel border border-line bg-raise p-4 outline-none sm:p-6"
      aria-label={title}
      tabIndex={-1}
      ref={shelf}
    >
      <div className="grid gap-x-7 gap-y-5 md:grid-cols-[minmax(11rem,19rem)_minmax(0,1fr)] xl:grid-cols-[minmax(11rem,19rem)_minmax(0,1fr)_minmax(13rem,18rem)]">
        {recipe?.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt=""
            className="aspect-[16/10] w-full rounded-tile object-cover md:sticky md:top-6 md:aspect-[4/5]"
          />
        ) : (
          <div className="ruled rounded-tile max-md:hidden md:sticky md:top-6 md:aspect-[4/5]" aria-hidden="true" />
        )}

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="pt-1.5 text-ui text-mute">
              {SLOT_LABELS[slotName]} · {WEEK_DAYS[day]} of Week {week + 1}
              {recipe ? ` · ${servings} ${servings === 1 ? 'serving' : 'servings'}` : ''}
              {slot.leftover ? ' · reheated from an earlier meal' : ''}
            </p>
            <IconButton onClick={onClose} aria-label="Close recipe">
              <Close />
            </IconButton>
          </div>
          <h3 className="mt-1 text-3xl font-extrabold tracking-tight text-balance max-sm:text-2xl">
            {title}
          </h3>

          {problems.length ? (
            <Banner variant="error" compact className="mt-4">
              <strong>Do not cook this as planned.</strong>{' '}
              {problems.map((problem) => problem.message).join('. ')}. Swap it for
              one of the alternatives.
            </Banner>
          ) : null}

          {slot.recipe && !recipe ? (
            <Banner variant="error" compact className="mt-4">
              {slot.recipe} is no longer in the recipe list. Choose another meal.
            </Banner>
          ) : null}

          {recipe ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => acceptSlot(week, day, slotIndex)}
                disabled={slot.status === MEAL_STATUS.ACCEPTED}
              >
                {slot.status === MEAL_STATUS.ACCEPTED ? 'Accepted' : 'Accept this meal'}
              </Button>
              <Button
                onClick={() => rejectSlot(week, day, slotIndex)}
                disabled={slot.status === MEAL_STATUS.REJECTED}
              >
                {slot.status === MEAL_STATUS.REJECTED ? 'Rejected' : 'Reject'}
              </Button>
              <Button aria-pressed={slot.saved} onClick={() => toggleSavedSlot(week, day, slotIndex)}>
                {slot.saved ? 'Saved' : 'Save this recipe'}
              </Button>
              <Button disabled={isBusy} onClick={() => requestAlternative(week, day, slotIndex)}>
                {isBusy ? 'Finding another…' : 'Suggest another'}
              </Button>
              {isCustomRecipe(recipe) ? (
                <Button onClick={() => onEditRecipe?.(recipe)}>Edit this recipe</Button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5">
            <SlotPicker week={week} day={day} slotIndex={slotIndex} />
          </div>

          {recipe ? (
            <div className="mt-6 border-t border-line pt-5">
              <RecipeDetail recipe={recipe} servings={servings} conflicts={conflicts} heading="h4" />
            </div>
          ) : null}
        </div>

        {recipe ? (
          <div className="max-xl:col-span-full max-xl:border-t max-xl:border-line max-xl:pt-5">
            <h4 className="mb-3 text-base font-bold">Alternatives that fit your setup</h4>
            {alternatives.length ? (
              <ul className="grid gap-3.5 max-xl:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
                {alternatives.map((option) => (
                  <li key={option.name} className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-start gap-3">
                    {option.imageUrl ? (
                      <img
                        src={option.imageUrl}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/5] w-full rounded-flag object-cover"
                      />
                    ) : (
                      <span className="ruled block aspect-[4/5] w-full rounded-flag" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="leading-tight font-bold">{option.name}</p>
                      <p className="mt-1 mb-2 text-sm text-mute">
                        {isNamesOnly(option)
                          ? namesOnlyMeta(option)
                          : `${option.cookTimeMinutes} min · ${option.nutritionPerServing.calories} kcal · ${option.nutritionPerServing.protein} g protein per serving`}
                      </p>
                      <Button
                        size="sm"
                        onClick={() =>
                          setSlot(week, day, slotIndex, {
                            recipe: option.name,
                            leftover: false,
                          })
                        }
                      >
                        Use this
                        <span className="sr-only">: {option.name}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-mute">
                No other {slotName} option fits your allergies and diet. Remake the
                plan for new ones, or relax a restriction in Setup.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
