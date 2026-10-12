import { usePlanSummary } from '../../hooks/usePlanSummary'

function Stat({ label, value, detail, alert = false }) {
  return (
    <div className={alert ? 'text-danger' : undefined}>
      <dt className="text-xs text-mute">{label}</dt>
      <dd className={alert ? undefined : 'text-mute'}>
        <strong className={`text-lg font-bold tracking-tight ${alert ? '' : 'text-ink'}`}>{value}</strong>{' '}
        {detail}
      </dd>
    </div>
  )
}

const describeGoal = (actual, goal, unit) => {
  if (!goal) return 'No goal set'
  const delta = actual - goal
  if (Math.abs(delta) <= goal * 0.05) return 'On target'
  return delta > 0
    ? `${delta.toLocaleString()}${unit} over your goal`
    : `${Math.abs(delta).toLocaleString()}${unit} under your goal`
}

// Requirement 5.3: aggregated nutrition for the week against the user's goals.
// One line of figures under a hairline, not a row of cards. There is no cost
// here: the planner's recipes come without prices, and real ones first appear
// in the buying agent's cart.
export function PlanSummary({ week }) {
  const summary = usePlanSummary(week)

  return (
    <dl className="flex flex-wrap gap-x-9 gap-y-3 border-y border-line py-3.5">
      <Stat
        label="Calories per person/day"
        value={summary.plannedDays ? summary.calories.toLocaleString() : '—'}
        detail={describeGoal(summary.calories, summary.calorieGoal, ' kcal')}
      />
      <Stat
        label="Protein per person/day"
        value={summary.plannedDays ? `${summary.protein}g` : '—'}
        detail={describeGoal(summary.protein, summary.proteinGoal, 'g')}
      />
      <Stat
        label="Carbs / fat per person/day"
        value={summary.plannedDays ? `${summary.carbs}g / ${summary.fat}g` : '—'}
        detail="Estimated from recipe macros"
      />
      <Stat
        label="Days planned"
        value={`${summary.plannedDays} / 7`}
        detail={`${summary.filledSlots} of ${summary.totalSlots} meal slots filled`}
      />
      <Stat
        label="Days needing a fix"
        value={summary.problemDays.length}
        detail={
          summary.problemDays.length
            ? summary.problemDays.join(', ')
            : 'Every planned day checks out'
        }
        alert={Boolean(summary.problemDays.length)}
      />
    </dl>
  )
}
