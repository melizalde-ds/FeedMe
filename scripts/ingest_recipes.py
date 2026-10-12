# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "boto3>=1.39",
#     "polars",
#     "python-dotenv",
#     "qdrant-client",
# ]
# ///
"""Embed the recipes parquet with Titan Text Embeddings V2 on Bedrock and load it into Qdrant.

    uv run scripts/ingest_recipes.py --limit 200    # cheap trial run
    uv run scripts/ingest_recipes.py                # everything
    uv run scripts/ingest_recipes.py --query "quick vegetarian dinner"

Re-running is safe: recipes already in Qdrant are skipped, so an interrupted
run picks up where it stopped. Vectors from different models can't share a
collection, so pass --recreate after changing the model. Needs
AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key) in the repo-root .env, and Qdrant
running (docker compose up -d qdrant).
"""

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
import polars as pl
import polars.selectors as cs
from botocore.config import Config
from dotenv import load_dotenv
from qdrant_client import QdrantClient, models

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

REGION = os.environ.get("AWS_REGION", "us-east-1")
# An Amazon model, so unlike Cohere it needs no AWS Marketplace subscription.
MODEL_ID = os.environ.get("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION = os.environ.get("QDRANT_COLLECTION", "recipes")

EMBED_DIM = 1024  # Titan V2 supports 256, 512 and 1024
BATCH_SIZE = 100  # recipes per Qdrant round trip

# Left out of the payload: they repeat other columns or are constant.
PAYLOAD_EXCLUDE = ["embed_text", "ingredients_text", "instructions_text", "n_ingredients_missing"]

# Fields the API will filter on, e.g. must_not ingredients for allergies.
PAYLOAD_INDEXES = {
    "ingredients": models.PayloadSchemaType.KEYWORD,
    "keywords": models.PayloadSchemaType.KEYWORD,
    "category": models.PayloadSchemaType.KEYWORD,
    "is_component": models.PayloadSchemaType.BOOL,
    "has_alcohol": models.PayloadSchemaType.BOOL,
    "total_min": models.PayloadSchemaType.INTEGER,
    "calories": models.PayloadSchemaType.FLOAT,
    # Share of calories from carbohydrates, for the low-carb diet filter.
    "carb_pct": models.PayloadSchemaType.FLOAT,
}

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=REGION,
    config=Config(
        # Adaptive mode slows down by itself when Bedrock throttles.
        retries={"max_attempts": 10, "mode": "adaptive"},
        # Above --workers, so threads don't wait on each other for a connection.
        max_pool_connections=64,
    ),
)
qdrant = QdrantClient(url=QDRANT_URL)


def embed(text: str) -> list[float]:
    """Embed one text, which is all Titan takes per call.

    Recipes and queries are embedded the same way. Queries must use the same
    model and EMBED_DIM as the documents.
    """
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({"inputText": text, "dimensions": EMBED_DIM, "normalize": True}),
    )
    return json.loads(response["body"].read())["embedding"]


def load_recipes(path: Path, limit: int | None) -> pl.DataFrame:
    # Payloads are sent as JSON, which has no datetime or NaN.
    return pl.read_parquet(path, n_rows=limit).with_columns(
        cs.datetime().dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        cs.float().fill_nan(None),
    )


def ensure_collection(recreate: bool) -> None:
    if recreate and qdrant.collection_exists(COLLECTION):
        qdrant.delete_collection(COLLECTION)
    if not qdrant.collection_exists(COLLECTION):
        qdrant.create_collection(
            COLLECTION,
            vectors_config=models.VectorParams(size=EMBED_DIM, distance=models.Distance.COSINE),
        )
    # Also on a collection that exists, so an index added here later reaches it.
    # Creating one that is already there changes nothing.
    for field, schema in PAYLOAD_INDEXES.items():
        qdrant.create_payload_index(COLLECTION, field, schema)


def ingest_batch(batch: pl.DataFrame, pool: ThreadPoolExecutor) -> int:
    """Embed and upsert the recipes in this batch that Qdrant doesn't have yet."""
    existing = qdrant.retrieve(COLLECTION, ids=batch["recipe_id"].to_list(), with_payload=False)
    batch = batch.filter(~pl.col("recipe_id").is_in([point.id for point in existing]))
    if batch.is_empty():
        return 0
    vectors = pool.map(embed, batch["embed_text"].to_list())
    payloads = batch.drop(PAYLOAD_EXCLUDE).to_dicts()
    qdrant.upsert(
        COLLECTION,
        points=[
            # recipe_id is the point id, and stays in the payload too.
            models.PointStruct(id=payload["recipe_id"], vector=vector, payload=payload)
            for payload, vector in zip(payloads, vectors, strict=True)
        ],
    )
    return len(batch)


def ingest(path: Path, limit: int | None, workers: int, recreate: bool) -> None:
    recipes = load_recipes(path, limit)
    ensure_collection(recreate)
    seen = added = 0
    with ThreadPoolExecutor(workers) as pool:
        try:
            for batch in recipes.iter_slices(BATCH_SIZE):
                added += ingest_batch(batch, pool)
                seen += len(batch)
                print(f"\r{seen}/{len(recipes)} recipes checked, {added} embedded", end="", flush=True)
        except BaseException:
            pool.shutdown(cancel_futures=True)
            raise
        finally:
            print()
    print(f"{COLLECTION} now holds {qdrant.count(COLLECTION).count} recipes")


def search(query: str, limit: int = 5) -> None:
    vector = embed(query)
    for hit in qdrant.query_points(COLLECTION, query=vector, limit=limit).points:
        print(f"{hit.score:.3f}  {hit.id:>7}  {hit.payload['name']}  [{hit.payload['category']}]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("parquet", nargs="?", type=Path, default=ROOT / "data" / "recipes_clean.parquet")
    parser.add_argument("--limit", type=int, help="only ingest the first N recipes")
    parser.add_argument("--workers", type=int, default=16, help="parallel Bedrock calls")
    parser.add_argument("--recreate", action="store_true", help="drop the collection and start over")
    parser.add_argument("--query", help="search the collection instead of ingesting")
    args = parser.parse_args()

    if args.query:
        search(args.query)
    else:
        ingest(args.parquet, args.limit, args.workers, args.recreate)
