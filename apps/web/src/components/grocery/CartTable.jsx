import { HOLD_REASONS, money, storeName } from '../../lib/shopping'

const bySlug = (totals) =>
  new Map((totals?.stores ?? []).map((store) => [store.store, store]))

// The buying agent's cart, one table per store. Prices and pack counts are the
// stores' own, set by the server. `onRemove` is left out while a run is
// working on the cart.
export function CartTable({ cart, onRemove, busy = false }) {
  const items = cart?.items ?? []
  if (!items.length) return null

  const stores = [...new Set(items.map((item) => item.store))].sort()
  // What the cart costs if every product marked for review is kept.
  const totals = bySlug(cart.if_all_approved)

  return (
    <div className="flex flex-col gap-4">
      {stores.map((slug) => {
        const lines = items.filter((item) => item.store === slug)
        const total = totals.get(slug)

        return (
          <div key={slug} className="table-wrap">
            <table className="data-table">
              <caption className="pb-2 text-left font-semibold text-ink">
                {storeName(slug)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">For</th>
                  <th scope="col">Packs</th>
                  <th scope="col">Price</th>
                  <th scope="col">Status</th>
                  {onRemove ? (
                    <th scope="col">
                      <span className="visually-hidden">Remove</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((item) => (
                  <tr key={`${item.store}-${item.upc}`}>
                    <th scope="row">
                      {item.name}
                      <span className="block text-sm font-normal text-mute">
                        {[item.brand, item.size].filter(Boolean).join(' · ')}
                      </span>
                    </th>
                    <td className="data-table__muted">{item.for_ingredient}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.unit_price_cents * item.quantity)}</td>
                    <td>
                      {item.status === 'in_cart' ? (
                        <span className="chip chip--good">In the cart</span>
                      ) : (
                        <span className="chip chip--warn">Check this</span>
                      )}
                      {item.hold_reasons?.length ? (
                        <span className="mt-1 block text-sm text-mute">
                          {item.hold_reasons
                            .map((reason) => HOLD_REASONS[reason] ?? reason)
                            .join('; ')}
                        </span>
                      ) : null}
                    </td>
                    {onRemove ? (
                      <td>
                        <button
                          type="button"
                          className="button button--small"
                          disabled={busy}
                          onClick={() => onRemove(item.store, item.upc)}
                        >
                          Remove
                          <span className="visually-hidden"> {item.name}</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              {total ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan="3">
                      {storeName(slug)} total
                      <span className="block text-sm font-normal text-mute">
                        {total.delivery_fee_cents
                          ? `includes ${money(total.delivery_fee_cents)} delivery`
                          : 'free delivery'}
                      </span>
                    </th>
                    <td colSpan={onRemove ? 3 : 2}>{money(total.total_cents)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )
      })}

      <p className="m-0 font-semibold text-ink">
        Cart total, delivery included: {money(cart.if_all_approved?.total_cents)}
      </p>
    </div>
  )
}
