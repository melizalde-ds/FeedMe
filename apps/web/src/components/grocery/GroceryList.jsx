import { useGroceryList } from '../../hooks/useGroceryList'
import { tableClass, tdClass, thClass } from '../ui/table'

// The list itself: what to buy, how much where the recipe says, and which
// meals it is for. It keeps to a narrow column, so each item names its meals
// underneath itself.
export function GroceryList() {
  const { items } = useGroceryList()

  const noAmounts = items.some((item) => item.quantity === null)

  return (
    // Beside the agent the list is a reference, so on a wide screen it keeps
    // to the height of the window and scrolls inside it: the agent never
    // leaves view. It can take focus, so the keyboard can scroll it too.
    <section
      className="min-w-0 max-lg:order-2 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-4 lg:[scrollbar-width:thin]"
      aria-labelledby="grocery-list-title"
      tabIndex={0}
    >
      <h2 className="text-xl font-bold tracking-tight" id="grocery-list-title">
        Everything this plan needs
      </h2>
      <p className="mt-1 text-sm text-mute">
        {items.length} {items.length === 1 ? 'item' : 'items'}
      </p>

      <table className={`${tableClass} mt-3`}>
        <thead className="lg:sticky lg:top-0 lg:bg-ground">
          <tr>
            <th scope="col" className={thClass}>
              Item <span className="font-normal">and the meals it is used in</span>
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <th scope="row" className={`${tdClass} py-2`}>
                <span className="block font-semibold first-letter:uppercase">{item.name}</span>
                <span className="block text-sm text-mute">{item.usedIn.join(', ')}</span>
              </th>
              <td className={`${tdClass} py-2 text-right whitespace-nowrap ${item.quantity === null ? 'text-mute' : 'font-semibold'}`}>
                {item.quantity === null ? '—' : `${item.quantity} ${item.unit}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {noAmounts ? (
        <p className="mt-3 text-sm text-mute">
          Items marked &ldquo;—&rdquo; come from planner recipes, which list
          their ingredients without amounts. Prices come from the stores, when
          the buying agent shops.
        </p>
      ) : null}
    </section>
  )
}
