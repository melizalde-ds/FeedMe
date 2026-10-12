import { HOLD_REASONS, money, storeName } from '../../lib/shopping'
import { Button } from '../ui/Button'
import { Alert, Check } from '../ui/icons'
import { captionClass, tableClass, tdClass, tfootClass, thClass } from '../ui/table'

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
    <div className="flex flex-col gap-6">
      {stores.map((slug) => {
        const lines = items.filter((item) => item.store === slug)
        const total = totals.get(slug)

        return (
          <div key={slug} className="overflow-x-auto">
            <table className={`${tableClass} min-w-[34rem]`}>
              <caption className={captionClass}>{storeName(slug)}</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Product
                  </th>
                  <th scope="col" className={thClass}>
                    For
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Packs
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Price
                  </th>
                  <th scope="col" className={thClass}>
                    Status
                  </th>
                  {onRemove ? (
                    <th scope="col" className={thClass}>
                      <span className="sr-only">Remove</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((item) => (
                  <tr key={`${item.store}-${item.upc}`}>
                    <th scope="row" className={tdClass}>
                      <span className="font-semibold">{item.name}</span>
                      <span className="block text-sm text-mute">
                        {[item.brand, item.size].filter(Boolean).join(' · ')}
                      </span>
                    </th>
                    <td className={`${tdClass} text-mute`}>{item.for_ingredient}</td>
                    <td className={`${tdClass} text-right`}>{item.quantity}</td>
                    <td className={`${tdClass} text-right`}>
                      {money(item.unit_price_cents * item.quantity)}
                    </td>
                    <td className={tdClass}>
                      {item.status === 'in_cart' ? (
                        <span className="inline-flex items-center gap-1.5 text-ok">
                          <Check size={14} />
                          <span>In the cart</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <Alert size={14} />
                          <span>Check this</span>
                        </span>
                      )}
                      {item.hold_reasons?.length ? (
                        <span className="block text-sm text-mute">
                          {item.hold_reasons
                            .map((reason) => HOLD_REASONS[reason] ?? reason)
                            .join('; ')}
                        </span>
                      ) : null}
                    </td>
                    {onRemove ? (
                      <td className={`${tdClass} text-right`}>
                        <Button size="sm" disabled={busy} onClick={() => onRemove(item.store, item.upc)}>
                          Remove
                          <span className="sr-only"> {item.name}</span>
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              {total ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan="3" className={tfootClass}>
                      {storeName(slug)} total
                      <span className="block text-sm font-normal text-mute">
                        {total.delivery_fee_cents
                          ? `includes ${money(total.delivery_fee_cents)} delivery`
                          : 'free delivery'}
                      </span>
                    </th>
                    <td className={`${tfootClass} text-right`}>{money(total.total_cents)}</td>
                    <td colSpan={onRemove ? 2 : 1} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )
      })}

      <p className="text-lg font-bold tracking-tight">
        Cart total, delivery included: {money(cart.if_all_approved?.total_cents)}
      </p>
    </div>
  )
}
