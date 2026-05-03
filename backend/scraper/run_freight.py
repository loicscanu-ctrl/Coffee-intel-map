"""
Standalone runner for the Freightos scraper.
Used by GitHub Actions — runs only the freight scraper, not the full suite.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.async_api import async_playwright

from scraper.sources.freightos import run


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await run(page)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
