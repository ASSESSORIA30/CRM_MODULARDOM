"""
Configurador del CRM (pantalla): les opcions i el resum coincideixen amb el motor (i, per tant, amb la web).
    BASE_URL=http://localhost:3103 python3 -m pytest -q tests/e2e/test_configurator_ui.py
"""
import json
import os
import urllib.parse
import urllib.request

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3103")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def eur(cents):
    s = f"{cents // 100:,}".replace(",", ".")
    return f"{s},{cents % 100:02d} €"


def test_configurator_summary_matches_engine(browser):
    page = browser.new_page()
    page.goto(f"{BASE}/proves/configurador")
    page.get_by_test_id("cfg-metres").fill("180")
    page.get_by_test_id("cfg-room-4").click()
    page.get_by_test_id("cfg-bath-3").click()
    page.get_by_test_id("cfg-suite-bano_vestidor").click()
    page.get_by_test_id("cfg-kitchen-isla").click()
    page.get_by_test_id("cfg-garage-2").click()
    page.get_by_test_id("cfg-laundry").click()
    page.get_by_test_id("cfg-inst-aireConductos").click()
    page.get_by_test_id("cfg-extra-porche").click()
    page.get_by_test_id("cfg-extra-piscina").click()
    cfg = dict(metres=180, habitacions=4, banys=3, suite="bano_vestidor", cuina="isla", vehicles=2, safareig=True,
               installacions=["aireConductos"], extres=["porche", "piscina"])
    with urllib.request.urlopen(f"{BASE}/proves/motor?cfg={urllib.parse.quote(json.dumps(cfg))}") as r:
        engine = json.load(r)
    for l in engine["lines"]:
        key = l["key"]
        expect(page.get_by_test_id(f"cfg-line-{key}")).to_have_text(eur(l["amountCents"]).replace("\xa0", " "))
    expect(page.get_by_test_id("cfg-total")).to_have_text(eur(engine["totalCents"]))
    # Honoraris: 130 €/m² + 1.800 €
    expect(page.get_by_test_id("cfg-line-arquitecte")).to_have_text("25.200,00 €")
    page.close()


def test_minimum_surface(browser):
    page = browser.new_page()
    page.goto(f"{BASE}/proves/configurador")
    page.get_by_test_id("cfg-metres").fill("90")
    expect(page.get_by_test_id("configurator")).to_contain_text("La superfície mínima és de 100 m²")
    expect(page.get_by_test_id("cfg-generate")).to_be_disabled()
    page.close()
