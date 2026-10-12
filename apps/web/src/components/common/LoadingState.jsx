export function LoadingState({ label = 'Working…' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

// What is on screen while the planner works, in Setup and in the Plan view.
export function PlanBuildingState() {
  return (
    <LoadingState label="Saving your setup, then choosing meals and checking each one against your allergies and diet. This takes about half a minute." />
  )
}
