"""
Editor de pressupostos (FASE 2) amb dades fictícies: imports de línia, IVA per concepte i totals.
    BASE_URL=http://localhost:3103 python3 -m pytest -q tests/e2e/test_quote_editor.py
"""
import os

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3103")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def test_totals_and_vat_by_concept(browser):
    page = browser.new_page()
    page.goto(f"{BASE}/proves/pressupost")
    ed = page.get_by_test_id("quote-editor")
    expect(page.get_by_test_id("line-amount").first).to_have_text("258.180,00 €")
    # Projecte i direcció: en triar el concepte, l'IVA passa al 21 %
    page.get_by_test_id("add-base").click()
    row = page.get_by_test_id("quote-line").nth(1)
    row.get_by_label("Concepte").select_option("projecte_direccio")
    expect(row.get_by_label("IVA")).to_have_value("2100")
    row.get_by_label("Descripció").fill("Projecte, direcció i final d'obra")
    row.get_by_label("Preu unitari").fill("35.600")
    # Extra inclòs amb descompte del 10 %
    page.get_by_test_id("add-extra_inicial").click()
    ex = page.get_by_test_id("section-extra_inicial").get_by_test_id("quote-line").first
    ex.get_by_label("Descripció").fill("Cuina")
    ex.get_by_label("Preu unitari").fill("12300")
    ex.get_by_label("Dte. %").fill("10")
    expect(ex.get_by_test_id("line-amount")).to_have_text("11.070,00 €")
    # Descompte: l'import es resta encara que s'escrigui en positiu
    page.get_by_test_id("add-descompte").click()
    ds = page.get_by_test_id("section-descompte").get_by_test_id("quote-line").first
    ds.get_by_label("Descripció").fill("Descompte comercial")
    ds.get_by_label("Preu unitari").fill("1.000")
    expect(ds.get_by_test_id("line-amount")).to_have_text("-1.000,00 €")
    # 258.180 + 35.600 + 11.070 − 1.000 = 303.850 · IVA: 10 % de 268.250 (26.825) + 21 % de 35.600 (7.476)
    expect(page.get_by_test_id("total-taxable")).to_have_text("303.850,00 €")
    expect(page.get_by_test_id("total-with-vat")).to_have_text("338.151,00 €")
    expect(ed).to_contain_text("Hi ha canvis sense desar")
    page.close()


def test_invalid_quantity_is_flagged(browser):
    page = browser.new_page()
    page.goto(f"{BASE}/proves/pressupost")
    row = page.get_by_test_id("quote-line").first
    row.get_by_label("Quantitat").fill("abc")
    assert "border-red-500" in row.get_by_label("Quantitat").get_attribute("class")
    expect(row.get_by_test_id("line-amount")).to_have_text("—")
    row.get_by_label("Quantitat").fill("100,5")
    expect(row.get_by_test_id("line-amount")).to_have_text("99.796,50 €")
    page.close()


def test_mobile_layout_scrolls(browser):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(f"{BASE}/proves/pressupost")
    expect(page.get_by_test_id("save-draft")).to_be_visible()
    width = page.evaluate("document.documentElement.scrollWidth")
    assert width <= 400, width  # la taula es desplaça dins del seu contenidor, no la pàgina
    ctx.close()
