import { MEAL_SLOTS, MEAL_STATUS, SLOT_LABELS, WEEK_DAYS } from '../../lib/constants'
import { isCustomRecipe } from '../../lib/customRecipes'
import { recipeProblems } from '../../lib/mealFilters'
import { dayIssues, dayNutrition, findRecipe } from '../../lib/planner'
import { slotKey } from '../../lib/slotKey'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { Alert, Check, Plus, Star } from '../ui/icons'

// Whole calories, and protein to one decimal: sums of the recipes' figures
// are never shown with a float's tail.
const kcal = (value) => Math.round(value).toLocaleString()
const grams = (value) => Math.round(value * 10) / 10

const mealLabel = (day, slotIndex) =>
  `${SLOT_LABELS[MEAL_SLOTS[slotIndex]]} on ${WEEK_DAYS[day]}`

// The one thing most worth saying about a meal, in words on its photograph.
// A meal with nothing to say gets no flag.
function flagFor({ slot, recipe, problems, changed }) {
  if (!recipe) return { kind: 'bad', text: 'No longer in the recipe list', icon: <Alert size={13} /> }
  if (problems.length) return { kind: 'bad', text: problems[0].message, icon: <Alert size={13} /> }
  if (changed) return { kind: 'new', text: 'Changed' }
  if (slot.status === MEAL_STATUS.REJECTED) return { kind: 'quiet', text: 'Rejected' }
  if (slot.leftover) return { kind: 'plain', text: 'Leftovers' }
  if (isCustomRecipe(recipe)) return { kind: 'plain', text: 'Yours' }
  if (slot.status === MEAL_STATUS.ACCEPTED) return { kind: 'ok', text: 'Accepted', icon: <Check size={13} /> }
  return null
}

function Tile({ week, day, slotIndex, selected, onSelect }) {
  const { plan, highlight } = useMealPlan()
  const { preferences } = useHousehold()

  const slot = plan.weeks[week][day][slotIndex]
  const label = mealLabel(day, slotIndex)
  const dayName = WEEK_DAYS[day].slice(0, 3)

  if (!slot.recipe) {
    return (
      <button
        type="button"
        className="tile tile--empty"
        aria-label={`Choose a meal for ${label}`}
        aria-expanded={selected}
        data-on={selected ? '' : undefined}
        onClick={onSelect}
      >
        <span className="flag lg:hidden">{dayName}</span>
        <Plus size={16} />
        <span className="text-sm font-semibold">Choose a meal</span>
      </button>
    )
  }

  const recipe = findRecipe(plan, slot.recipe)
  const problems = recipe ? recipeProblems(recipe, preferences) : []
  const changed = Boolean(highlight?.includes(slotKey(week, day, slotIndex)))
  const flag = flagFor({ slot, recipe, problems, changed })
  const bad = flag?.kind === 'bad'
  const nutrition = recipe?.nutritionPerServing
  const more = [
    recipe?.cookTimeMinutes == null ? null : `${recipe.cookTimeMinutes} min`,
    nutrition?.calories == null ? null : `${kcal(nutrition.calories)} kcal`,
    nutrition?.protein == null ? null : `${grams(nutrition.protein)} g protein`,
    slot.servings ? `for ${slot.servings}` : null,
  ].filter(Boolean)

  return (
    <button
      type="button"
      className="tile"
      data-on={selected ? '' : undefined}
      data-bad={bad ? '' : undefined}
      data-leftover={slot.leftover ? '' : undefined}
      data-rejected={slot.status === MEAL_STATUS.REJECTED ? '' : undefined}
      aria-expanded={selected}
      aria-label={`${label}: ${slot.leftover ? 'leftovers of ' : ''}${slot.recipe}${
        bad ? `. ${flag.text}` : ''
      }`}
      onClick={onSelect}
    >
      {recipe?.imageUrl ? (
        <img className="tile__photo" src={recipe.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="tile__photo ruled" aria-hidden="true" />
      )}
      <span className="tile__top">
        <span className="flag lg:hidden">{dayName}</span>
        {flag ? (
          <span className="flag" data-kind={flag.kind}>
            {flag.icon}
            {flag.text}
          </span>
        ) : null}
        {slot.saved ? (
          <span className="flag" title="Saved">
            <Star size={13} />
            <span className="sr-only">Saved</span>
          </span>
        ) : null}
      </span>
      <span className="tile__body">
        <span className="tile__name">{slot.recipe}</span>
        {more.length ? <span className="tile__more">{more.join(' · ')}</span> : null}
      </span>
    </button>
  )
}

// A day's verdict: what needs fixing, or that it is fine, and how its
// figures sit against the goals once all three meals are planned.
function DaySummary({ week, day }) {
  const { plan } = useMealPlan()
  const { preferences } = useHousehold()

  const issues = dayIssues(plan, week, day, preferences)
  const nutrition = dayNutrition(plan, week, day)

  const calorieGoal = Number(preferences.nutritionGoals?.calories) || 0
  const proteinGoal = Number(preferences.nutritionGoals?.protein) || 0

  // Only judge a day against the goals once all three meals are planned.
  const complete = nutrition.filled === MEAL_SLOTS.length
  const notes = []
  if (complete && calorieGoal) {
    if (nutrition.calories < calorieGoal * 0.8) notes.push('below your calorie goal')
    else if (nutrition.calories > calorieGoal * 1.2) notes.push('above your calorie goal')
  }
  if (complete && proteinGoal && nutrition.protein < proteinGoal * 0.8) {
    notes.push('short on protein')
  }

  return (
    <li className="flex flex-col gap-0.5 px-0.5 pb-1 text-xs text-mute">
      <strong className="text-base font-bold text-ink">{WEEK_DAYS[day]}</strong>
      {issues.length ? (
        <span className="flex items-start gap-1 font-bold text-danger">
          <Alert size={14} className="mt-px shrink-0" />
          {issues.join('; ')}
        </span>
      ) : nutrition.filled ? (
        <span className="flex items-center gap-1 font-bold text-ok">
          <Check size={14} className="shrink-0" />
          OK
        </span>
      ) : (
        <span>Nothing planned</span>
      )}
      {nutrition.filled ? (
        <span>
          {kcal(nutrition.calories)} kcal · {grams(nutrition.protein)} g protein per person
          {notes.length ? <span className="block">{notes.join(', ')}</span> : null}
        </span>
      ) : null}
    </li>
  )
}

// The week: a row of day verdicts, then one rail of photographs per meal,
// with the days as columns. The recipe of the meal in hand unfolds under its
// own rail: `shelf` is that recipe view.
export function Wall({ week, selected, onSelect, shelf }) {
  return (
    <div className="wall flex flex-col gap-3.5 max-lg:gap-5">
      <section className="rail" aria-labelledby="rail-days">
        <h2 id="rail-days" className="pb-2 text-lg font-bold tracking-tight lg:sr-only">
          Days
        </h2>
        <ul className="rail__tiles lg:col-start-2">
          {WEEK_DAYS.map((name, day) => (
            <DaySummary key={name} week={week} day={day} />
          ))}
        </ul>
      </section>

      {MEAL_SLOTS.map((mealType, slotIndex) => (
        <section key={mealType} className="rail" aria-labelledby={`rail-${mealType}`}>
          <h2 id={`rail-${mealType}`} className="pt-1.5 pb-2 text-lg font-bold tracking-tight">
            {SLOT_LABELS[mealType]}
          </h2>
          <ul className="rail__tiles">
            {WEEK_DAYS.map((name, day) => {
              const on = selected?.day === day && selected?.slotIndex === slotIndex
              return (
                <li key={name}>
                  <Tile
                    week={week}
                    day={day}
                    slotIndex={slotIndex}
                    selected={on}
                    onSelect={() => onSelect(on ? null : { week, day, slotIndex })}
                  />
                </li>
              )
            })}
          </ul>
          {selected?.slotIndex === slotIndex ? shelf : null}
        </section>
      ))}
    </div>
  )
}
