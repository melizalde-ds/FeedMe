import { useGroceryList } from '../../hooks/useGroceryList'
import { useHousehold } from '../../hooks/useHousehold'
import { BuyPanel } from './BuyPanel'

export function GroceryList() {
  const { items, mealCount, week } = useGroceryList()
  const { preferences } = useHousehold()

  const noAmounts = items.some((item) => item.quantity === null)

  return (
    <>
      <p className="panel__lede">
        Built from the {mealCount} {mealCount === 1 ? 'meal' : 'meals'} you
        confirmed in Week {week + 1}, for your household of{' '}
        {preferences.householdSize}. Leftover slots buy nothing extra.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Amount</th>
              <th scope="col">Used in</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <th scope="row">{item.name}</th>
                <td>
                  {item.quantity === null ? '—' : `${item.quantity} ${item.unit}`}
                </td>
                <td className="data-table__muted">{item.usedIn.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {noAmounts ? (
        <p className="fine-print">
          Items marked &ldquo;—&rdquo; come from planner recipes, which list
          their ingredients without amounts. Prices come from the stores, when
          the buying agent shops.
        </p>
      ) : null}

      <BuyPanel />
    </>
  )
}
