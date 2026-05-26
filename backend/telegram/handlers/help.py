HELP_TEXT = """\
Coffee Intel Bot — commands:

/brief       Morning summary
/prices      Current futures &amp; physical
/quote       Robusta quotation (+ options)
/cot         COT report KC + RC
/brazil      Brazil daily registrations
/kaffeesteuer  German clearances
/ecf         EU port stocks
/run &lt;name&gt;  Trigger scraper (prices|cot|cecafe|kaffeesteuer|ecf|brief)
/help        This message

Examples:
  /quote basis=-140 eudr bb
  /run prices\
"""


def handle(args: str, context: dict) -> str:
    return HELP_TEXT
