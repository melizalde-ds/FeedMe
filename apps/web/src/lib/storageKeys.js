// Local storage keys shared by more than one module. Everything a signed-in
// user keeps in this browser is under their own keys, so two people sharing a
// browser never see each other's Setup, plan or recipes.

export const accountPreferencesKey = (userId) => `feedme.account.${userId}.preferences`
// v3: a plan is at most two weeks and starts in week 0, so an older stored
// plan (five weeks, starting in week 1) is not read.
export const accountPlanKey = (userId) => `feedme.account.${userId}.plan.v3`
export const accountRecipesKey = (userId) => `feedme.account.${userId}.recipes`
