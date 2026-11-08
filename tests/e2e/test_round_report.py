"""
Proves de l'informe de ronda (FASE D) amb dades fictícies.
    BASE_URL=http://localhost:3103 python3 -m pytest -q tests/e2e/test_round_report.py
Comprova la vista HTML i que el PDF descarregat conté el resum, les referències,
les captures dels marcadors i la fotografia.
"""
import os
import subprocess
import tempfile

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3103")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def test_html_summary(browser):
    page = browser.new_page()
    page.goto(f"{BASE}/proves/informe")
    rep = page.get_by_test_id("round-report")
    expect(rep).to_contain_text("Modificacions incorporades (1)")
    expect(rep).to_contain_text("Alternatives acceptades (1)")
    expect(rep).to_contain_text("Peticions no viables (1)")
    expect(rep).to_contain_text("Punts pendents (0)")
    for ref in ("R1.1", "R1.2", "R1.3"):
        expect(page.locator(f"section#{ref.replace('.', '\\.')}")).to_have_count(1)
    page.close()


def test_pdf_download_contents(browser):
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/proves/informe")
    with page.expect_download(timeout=60000) as dl:
        page.get_by_test_id("report-download").click()
    d = dl.value
    assert d.suggested_filename == "MD-2026-000-informe-ronda-1.pdf"
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "informe.pdf")
        d.save_as(path)
        with open(path, "rb") as f:
            assert f.read(5) == b"%PDF-"
        text = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, check=True).stdout
        for needle in ("R1.1", "R1.2", "R1.3", "Modificacions incorporades", "Alternatives acceptades", "Peticions no viables",
                       "Dutxa de 90 cm amb mampara", "S'amplia a 2,40 m.", "Avantprojecte", "Pàgina 1 de"):
            assert needle in text, needle
        imgs = subprocess.run(["pdfimages", "-list", path], capture_output=True, text=True, check=True).stdout.strip().splitlines()[2:]
        # 3 captures de marcadors (2 sobre PDF, 1 sobre imatge) + 1 fotografia
        assert len(imgs) == 4, imgs
    assert not errors, errors
    page.close()
