"""Builds .redesign/fixtures/meal-options.json: a POST /api/meal-options answer
made of real rows from data/recipes_clean.parquet. Test harness only: the
Playwright scripts serve it in place of the live planner, which needs Bedrock.

    uv run --with polars python .redesign/scripts/make_fixture.py
"""
import json
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parents[2]
df = pl.read_parquet(ROOT / "data" / "recipes_clean.parquet")

base = df.filter(
    (~pl.col("is_component"))
    & (~pl.col("has_alcohol"))
    & pl.col("image_url").is_not_null()
    & pl.col("total_min").is_between(10, 30)
    & pl.col("calories").is_between(250, 750)
    & (pl.col("review_count") >= 20)
    & (pl.col("ingredients").list.len().is_between(5, 11))
    & (pl.col("instructions").list.len().is_between(3, 9))
    & (pl.col("name").str.len_chars() <= 42)
)

PICKS = {
    "breakfast": base.filter(pl.col("category") == "Breakfast"),
    "lunch": base.filter(pl.col("category").is_in(["Lunch/Snacks", "One Dish Meal", "Vegetable"])),
    "dinner": base.filter(pl.col("category").is_in(["Chicken Breast", "Chicken", "Meat", "Pork", "Stew"])),
}

SHOWN, QUEUED = 5, 4
meals = {}
for meal_type, rows in PICKS.items():
    rows = rows.sort(["rating_bayes", "review_count", "recipe_id"], descending=[True, True, False]).head(SHOWN + QUEUED)
    options = []
    for rank, row in enumerate(rows.to_dicts()):
        options.append(
            {
                "id": f"fixture-{meal_type}-{rank}",
                "recipe_id": str(row["recipe_id"]),
                "meal_type": meal_type,
                "day_index": rank if rank < SHOWN else None,
                "rank": rank,
                "is_headline": rank < SHOWN,
                "status": "suggested",
                "title": row["name"],
                "image_url": row["image_url"],
                "cook_time_minutes": row["total_min"],
                "servings": row["servings"],
                "nutrition": {
                    "calories": row["calories"],
                    "protein_g": row["protein_g"],
                    "carbs_g": row["carbs_g"],
                    "fat_g": row["fat_g"],
                },
                "compliance": {},
                "ingredients": row["ingredients"],
                "instructions": row["instructions"],
            }
        )
    meals[meal_type] = options

answer = {
    "session_id": "fixture-session-1",
    "status": "ready",
    "plan_days": SHOWN,
    "warnings": [],
    "meals": meals,
}
out = ROOT / ".redesign" / "fixtures" / "meal-options.json"
out.write_text(json.dumps(answer, indent=1))
for meal_type, options in meals.items():
    print(meal_type, [o["title"] for o in options])
