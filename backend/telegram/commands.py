from __future__ import annotations
from telegram.handlers import (
    brief,
    cot,
    brazil,
    ecf,
    help as help_handler,
    kaffeesteuer,
    prices,
    quote,
    run,
)

DISPATCH: dict[str, object] = {
    "brief":        brief.handle,
    "cot":          cot.handle,
    "brazil":       brazil.handle,
    "ecf":          ecf.handle,
    "help":         help_handler.handle,
    "kaffeesteuer": kaffeesteuer.handle,
    "prices":       prices.handle,
    "quote":        quote.handle,
    "run":          run.handle,
}
