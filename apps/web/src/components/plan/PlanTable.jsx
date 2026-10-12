import { MEAL_SLOTS, SLOT_LABELS, WEEK_DAYS } from '../../lib/constants'
import { dayIssues, dayNutrition } from '../../lib/planner'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { SlotPicker } from './SlotPicker'

function CheckCell({ week, day }) {
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
    <td className="plan-table__check">
      {issues.length ? (
        <span className="check check--bad">{issues.join('; ')}</span>
      ) : nutrition.filled ? (
        <span className="check check--ok">OK</span>
      ) : (
        <span className="check check--empty">Nothing planned</span>
      )}

      {nutrition.filled ? (
        <span className="check__nutrition">
          ~{nutrition.calories.toLocaleString()} kcal · {nutrition.protein} g
          protein per person
          {notes.length ? ` (${notes.join(', ')})` : ''}
        </span>
      ) : null}
    </td>
  )
}

export function PlanTable({ week, onOpenRecipe }) {
  const { highlight } = useMealPlan()

  return (
    <div className="table-wrap">
      <table className="plan-table">
        <caption className="visually-hidden">
          Meals for each day of week {week + 1}, with a status check per day
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {MEAL_SLOTS.map((slot) => (
              <th key={slot} scope="col">
                {SLOT_LABELS[slot]}
              </th>
            ))}
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {WEEK_DAYS.map((dayName, day) => {
            const isNew =
              highlight?.week === week && highlight.days.includes(day)

            return (
              <tr key={dayName} className={isNew ? 'is-new' : undefined}>
                <th scope="row" className="plan-table__day">
                  {dayName}
                </th>
                {MEAL_SLOTS.map((slot, slotIndex) => (
                  <td key={slot}>
                    <SlotPicker
                      week={week}
                      day={day}
                      slotIndex={slotIndex}
                      onOpenRecipe={onOpenRecipe}
                    />
                  </td>
                ))}
                <CheckCell week={week} day={day} />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
