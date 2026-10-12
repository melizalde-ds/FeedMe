export function SafetyDisclaimer() {
  return (
    <aside className="disclaimer" aria-label="Safety information">
      <h2 className="disclaimer__title">Check this before you cook</h2>
      <ul className="disclaimer__list">
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
