import { cx } from '../ui/cx'

export function LoadingState({ label = 'Working…', className }) {
  return (
    <div className={cx('flex items-center gap-3 py-3 text-base text-mute', className)} role="status" aria-live="polite">
      <span className="pulse size-3 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export const PLAN_BUILDING =
  'Saving your setup, then choosing meals and checking each one against your allergies and diet. This takes about half a minute.'

// What is on screen while the planner works, in Setup and in the Plan view:
// what is happening, how long it takes, and a row of tiles waiting to be
// filled.
export function PlanBuildingState() {
  return (
    <div role="status" aria-live="polite">
      <p className="text-xl font-bold tracking-tight">Building your plan</p>
      <p className="mt-2 max-w-[60ch] text-mute">{PLAN_BUILDING}</p>
      <div className="mt-6 grid grid-cols-4 gap-2.5 sm:grid-cols-7" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span
            key={index}
            className={cx('pulse aspect-[4/5] rounded-tile bg-raise', index > 3 && 'max-sm:hidden')}
            style={{ animationDelay: `${index * 120}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
