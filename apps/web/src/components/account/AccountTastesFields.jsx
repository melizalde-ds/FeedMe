import { useHousehold } from '../../hooks/useHousehold'
import { TermListField } from './TermListField'

// The household's food likes and dislikes, as two lists of short terms.
export function AccountTastesFields() {
  const { preferences, setPreference } = useHousehold()
  const liked = preferences.likedFoods ?? []
  const disliked = preferences.dislikedFoods ?? []

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <TermListField
        id="liked-foods"
        label="Foods you like"
        hint="The plan leans towards these."
        placeholder="e.g. chicken"
        values={liked}
        onChange={(next) => setPreference('likedFoods', next)}
        otherValues={disliked}
        otherLabel="foods you avoid"
      />
      <TermListField
        id="disliked-foods"
        label="Foods you avoid"
        hint="Meals with these are flagged so you can swap them."
        placeholder="e.g. mushrooms"
        values={disliked}
        onChange={(next) => setPreference('dislikedFoods', next)}
        otherValues={liked}
        otherLabel="foods you like"
      />
    </div>
  )
}
