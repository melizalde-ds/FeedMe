import { CURRENT_WEEK, WEEKS_IN_PLAN } from '../../lib/constants'
import { isWeekEmpty } from '../../lib/planner'
import { useMealPlan } from '../../hooks/useMealPlan'

const weekNote = (week, plan) => {
  if (isWeekEmpty(plan, week)) return 'not planned'
  return week === CURRENT_WEEK ? 'this week' : 'next week'
}

export function WeekTabs() {
  const { plan, currentWeek, goToWeek } = useMealPlan()

  return (
    <div className="week-tabs" role="tablist" aria-label="Weeks">
      {Array.from({ length: WEEKS_IN_PLAN }, (_, week) => (
        <button
          key={week}
          type="button"
          role="tab"
          aria-selected={week === currentWeek}
          className={`week-tabs__tab${week === currentWeek ? ' is-current' : ''}`}
          onClick={() => goToWeek(week)}
        >
          Week {week + 1}
          <span className="week-tabs__note">{weekNote(week, plan)}</span>
        </button>
      ))}
    </div>
  )
}
