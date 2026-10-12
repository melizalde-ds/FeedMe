import { CURRENT_WEEK, WEEKS_IN_PLAN } from '../../lib/constants'
import { isWeekEmpty } from '../../lib/planner'
import { useMealPlan } from '../../hooks/useMealPlan'

const weekNote = (week, plan) => {
  if (isWeekEmpty(plan, week)) return 'not planned'
  return week === CURRENT_WEEK ? 'this week' : 'next week'
}

// The id of the panel the tabs switch: the week on screen, in PlanView.
export const WEEK_PANEL_ID = 'plan-week'

export function WeekTabs() {
  const { plan, currentWeek, goToWeek } = useMealPlan()

  return (
    <div
      className="inline-flex rounded-tile bg-raise p-0.75 shadow-[inset_0_0_0_1px_var(--line)]"
      role="tablist"
      aria-label="Weeks"
    >
      {Array.from({ length: WEEKS_IN_PLAN }, (_, week) => (
        <button
          key={week}
          type="button"
          role="tab"
          aria-selected={week === currentWeek}
          aria-controls={WEEK_PANEL_ID}
          className="flex min-h-8.5 items-baseline gap-1.5 rounded-[9px] px-3.5 py-1 pointer-coarse:min-h-10 pointer-coarse:items-center text-base font-semibold text-mute transition-colors hover:text-ink aria-selected:bg-ink aria-selected:text-ground"
          onClick={() => goToWeek(week)}
        >
          Week {week + 1}
          <span className="text-xs font-normal">{weekNote(week, plan)}</span>
        </button>
      ))}
    </div>
  )
}
