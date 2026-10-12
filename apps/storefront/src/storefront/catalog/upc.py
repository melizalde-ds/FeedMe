"""UPC-A codes. Stored as 12-digit text, never as numbers."""


def check_digit(body: str) -> str:
    """Check digit for the first 11 digits of a UPC-A code."""
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(body))
    return str((10 - total % 10) % 10)


def upc_problem(upc: str) -> str | None:
    """Why a code is not usable in this catalog, or None if it is fine."""
    if len(upc) != 12 or not upc.isascii() or not upc.isdigit():
        return "must be exactly 12 digits"
    # GS1's company-internal range, so demo products can't collide with real ones.
    if upc[0] != "4":
        return "must start with 4 (company-internal range)"
    if check_digit(upc[:11]) != upc[11]:
        return f"bad check digit (expected {check_digit(upc[:11])})"
    return None
