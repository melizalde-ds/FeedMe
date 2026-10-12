// The standing caution at the foot of every step. Quiet, but always there.
export function SafetyDisclaimer() {
  return (
    <aside className="mt-12 border-t border-line pt-5 text-ui text-mute" aria-label="Safety information">
      <h2 className="text-base font-bold text-ink">Check this before you cook</h2>
      <ul className="mt-2 max-w-[72ch] list-disc space-y-1.5 pl-5">
        <li>
          Nutrition figures are estimates, as the recipes give them. They are
          not medical data.
        </li>
        <li>
          Allergy filtering is a starting point, not a guarantee. Read every
          product label yourself, including for ingredient substitutions.
        </li>
        <li>
          Nothing here is medical or dietary advice. Confirm anything
          safety-critical with a qualified professional.
        </li>
      </ul>
    </aside>
  )
}
