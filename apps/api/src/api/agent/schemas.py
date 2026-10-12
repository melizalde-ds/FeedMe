from typing import Any, Literal

from pydantic import BaseModel, Field

from api.cart.schemas import CartItem, CartView, Mode
from api.shopping.schemas import ListItem, Order


class ShoppingRequest(BaseModel):
    items: list[ListItem] = Field(min_length=1)
    mode: Mode = "manual"
    # The user's weekly budget. Auto mode needs one and falls back to manual without it.
    budget_cents: int | None = Field(default=None, ge=0)


class RunSummary(BaseModel):
    cart: CartView
    # Proposed items waiting for the user's approval.
    needs_check: list[CartItem]
    # Items on the list that were neither bought nor left in the cart.
    unmatched: list[str]
    # One order per store, all paid by a single payment. Paid items leave the cart.
    orders: list[Order]
    paid_total_cents: int
    best_single_store: str | None
    best_single_store_total_cents: int | None
    savings_cents: int | None


# --- Events, in the order a run streams them ---------------------------------


class RunStarted(BaseModel):
    type: Literal["run_started"] = "run_started"
    mode: Mode
    requested_mode: Mode
    note: str | None = None


class AgentMessage(BaseModel):
    type: Literal["message"] = "message"
    text: str


class ToolCalled(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    name: str
    arguments: dict[str, Any]


class ToolReturned(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    name: str
    ok: bool
    result: dict[str, Any]


class CartUpdated(BaseModel):
    type: Literal["cart_updated"] = "cart_updated"
    cart: CartView


class ApprovalNeeded(BaseModel):
    """A payment is waiting for the user to approve it in the Link app."""

    type: Literal["approval_needed"] = "approval_needed"
    # The stores this one payment covers.
    stores: list[str]
    total_cents: int
    approval_url: str | None


class Reminder(BaseModel):
    """The model said it was finished while work was still missing, and was told so."""

    type: Literal["reminder"] = "reminder"
    text: str


class RunFailed(BaseModel):
    type: Literal["error"] = "error"
    message: str


class Done(BaseModel):
    type: Literal["done"] = "done"
    # stopped_early: the model ended with work still missing, even after reminders.
    finish_reason: Literal["completed", "stopped_early", "step_limit"]
    summary: RunSummary


Event = (
    RunStarted
    | AgentMessage
    | ToolCalled
    | ToolReturned
    | CartUpdated
    | ApprovalNeeded
    | Reminder
    | RunFailed
    | Done
)
