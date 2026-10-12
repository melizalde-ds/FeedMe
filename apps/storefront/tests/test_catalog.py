import shutil

import pytest

from storefront.catalog.loader import CatalogError, load_catalog
from storefront.catalog.upc import check_digit, upc_problem
from storefront.settings import DATA_DIR


def test_check_digit_matches_a_known_upc():
    # 036000291452 is the standard worked example for UPC-A.
    assert check_digit("03600029145") == "2"


@pytest.mark.parametrize(
    ("upc", "problem"),
    [
        ("410010000011", None),
        ("410010000012", "bad check digit"),
        ("036000291452", "must start with 4"),
        ("41001000001", "12 digits"),
        ("41001000001x", "12 digits"),
    ],
)
def test_upc_problem(upc, problem):
    found = upc_problem(upc)
    assert found is None if problem is None else problem in found


def test_seed_data_loads():
    catalog = load_catalog(DATA_DIR)
    assert len(catalog.stores) == 6
    assert len(catalog.products) == 98
    assert len({p.equivalence_group for p in catalog.products.values()}) == 74
    # National brands keep one UPC everywhere; store brands stay in their own store.
    assert catalog.listing("staplemart", "410010000011").upc == "410010000011"
    assert catalog.listing("quickcart", "410010000011") is not None
    for product in catalog.products.values():
        if product.store_brand:
            sold_at = [s for s in catalog.stores if catalog.listing(s, product.upc)]
            assert sold_at == [product.store_brand]


def _copy_data(tmp_path, filename, old, new):
    shutil.copytree(DATA_DIR, tmp_path, dirs_exist_ok=True)
    path = tmp_path / filename
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new, 1))
    return tmp_path


def test_bad_check_digit_stops_the_load(tmp_path):
    data = _copy_data(tmp_path, "products.csv", "410010000011,", "410010000012,")
    with pytest.raises(CatalogError, match=r"products\.csv:2: .*bad check digit"):
        load_catalog(data)


def test_offer_for_unknown_upc_stops_the_load(tmp_path):
    data = _copy_data(tmp_path, "offers.csv", "staplemart,410010000011,", "staplemart,410010009991,")
    with pytest.raises(CatalogError, match=r"offers\.csv:2: unknown UPC"):
        load_catalog(data)


def test_search_ranks_the_closest_name_first():
    catalog = load_catalog(DATA_DIR)
    # Same number of words matched: the name the query covers most of comes first,
    # and the cheaper product wins a tie.
    hits = catalog.search("staplemart", "rice")
    assert [h.name for h in hits] == ["Brown Rice", "Basmati Rice", "Long Grain White Rice"]
    hits = catalog.search("staplemart", "cherry tomatoes")
    assert hits[0].name == "Cherry Tomatoes"
    assert (hits[0].match.matched, hits[0].match.of) == (2, 2)
    assert catalog.search("staplemart", "dragonfruit") == []
