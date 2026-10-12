class ShoppingError(Exception):
    """A request the agent can recover from, such as an unknown product.
    The message goes back to the model as a tool error."""


class CheckoutRefused(ShoppingError):
    """Some stores can't sell their part of a checkout. problems maps each such
    store to its reason."""

    def __init__(self, problems: dict[str, str]) -> None:
        reasons = "; ".join(f"{store}: {detail}" for store, detail in problems.items())
        super().__init__(f"The checkout was refused. {reasons}")
        self.problems = problems
