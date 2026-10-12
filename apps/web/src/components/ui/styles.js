// Tailwind class strings shared by the new screens (sign-in, account Setup,
// popups). Kept plain on purpose: restyle them here and every new screen
// follows. The colors are the app's tokens (see styles/tailwind.css).

export const ui = {
  button:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 py-2 font-semibold text-ink hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60',
  buttonPrimary:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-green bg-green px-4 py-2 font-semibold text-green-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
  buttonSmall:
    'inline-flex items-center justify-center gap-1 rounded-md border border-line bg-card px-3 py-1 text-sm font-semibold text-ink hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60',
  link: 'font-semibold text-green underline underline-offset-2 hover:no-underline',
  label: 'block font-semibold text-ink',
  hint: 'mt-1 text-sm text-mute',
  error: 'mt-1 text-sm font-semibold text-bad',
  input:
    'mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-ink aria-[invalid=true]:border-bad',
  card: 'rounded-xl border border-line bg-panel p-6 shadow-card',
  alert: 'rounded-lg border border-risk-line bg-risk-bg px-4 py-3 text-ink',
  notice: 'rounded-lg border border-line bg-cell-alt px-4 py-3 text-ink',
  chip: 'inline-flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1 text-sm text-ink',
}
