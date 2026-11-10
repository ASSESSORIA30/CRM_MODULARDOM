"""
Proves del visor de plànols (Playwright, Chromium).
Executar amb el servidor en marxa i ENABLE_TEST_ROUTES=1:
    BASE_URL=http://localhost:3103 python3 -m pytest -q tests/e2e/test_plan_viewer.py
"""
import os

import pytest
from playwright.sync_api import Page, expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3103")
TOL = 0.004  # tolerància en coordenades normalitzades (0,4 % de la pàgina)


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b, p
        b.close()


def open_viewer(page: Page, img=False):
    page.goto(f"{BASE}/proves/visor{'?img=1' if img else ''}")
    expect(page.get_by_text("Carregant…")).to_have_count(0, timeout=15000)
    page.wait_for_function("document.querySelector('[data-testid=plan-page]').getBoundingClientRect().height > 50")


def page_box(page: Page):
    return page.get_by_test_id("plan-page").bounding_box()


def at(page: Page, nx, ny):
    b = page_box(page)
    return b["x"] + nx * b["width"], b["y"] + ny * b["height"]


def rel_center(page: Page, testid):
    b = page.get_by_test_id(testid).bounding_box()
    p = page_box(page)
    return ((b["x"] + b["width"] / 2 - p["x"]) / p["width"], (b["y"] + b["height"] / 2 - p["y"]) / p["height"])


def rel_box(page: Page, testid):
    b = page.get_by_test_id(testid).bounding_box()
    p = page_box(page)
    return ((b["x"] - p["x"]) / p["width"], (b["y"] - p["y"]) / p["height"], b["width"] / p["width"], b["height"] / p["height"])


def annotations(page: Page):
    """Anotacions creades durant la prova (s'exclou la de l'arquitecte precarregada)."""
    return [a for a in page.evaluate("window.__annotations || []") if a["tone"] == "client"]


def zoom_pct(page: Page):
    return int(page.get_by_test_id("zoom").inner_text().rstrip("%"))


def test_desktop_markers_keep_position_after_zoom_and_resize(browser):
    b, _ = browser
    page = b.new_page(viewport={"width": 1280, "height": 900})
    open_viewer(page)

    # Mode navegació: un clic no crea res
    page.mouse.click(*at(page, 0.5, 0.5))
    assert annotations(page) == []

    # Marcador puntual
    page.locator("[data-mode=punt]").first.click()
    page.mouse.click(*at(page, 0.40, 0.30))
    anns = annotations(page)
    assert len(anns) == 1 and anns[0]["kind"] == "punt" and anns[0]["page"] == 1
    assert abs(anns[0]["x"] - 0.40) < TOL and abs(anns[0]["y"] - 0.30) < TOL
    mid = anns[0]["id"]

    # Rectangle
    page.locator("[data-mode=rectangle]").first.click()
    x1, y1 = at(page, 0.10, 0.60)
    x2, y2 = at(page, 0.30, 0.85)
    page.mouse.move(x1, y1); page.mouse.down(); page.mouse.move(x2, y2, steps=8); page.mouse.up()
    anns = annotations(page)
    rect = anns[-1]
    assert rect["kind"] == "rectangle"
    assert abs(rect["w"] - 0.20) < TOL and abs(rect["h"] - 0.25) < TOL

    before_marker = rel_center(page, f"annotation-{mid}")
    before_rect = rel_box(page, f"annotation-{rect['id']}")

    # Zoom amb botons i roda del ratolí
    page.get_by_label("Ampliar").click(); page.get_by_label("Ampliar").click()
    page.mouse.move(*at(page, 0.4, 0.3)); page.mouse.wheel(0, -400)
    assert zoom_pct(page) > 200
    after_marker = rel_center(page, f"annotation-{mid}")
    assert abs(after_marker[0] - before_marker[0]) < TOL and abs(after_marker[1] - before_marker[1]) < TOL
    after_rect = rel_box(page, f"annotation-{rect['id']}")
    for a, c in zip(before_rect, after_rect):
        assert abs(a - c) < TOL, (before_rect, after_rect)

    # Canvi de mida de pantalla
    page.set_viewport_size({"width": 700, "height": 900})
    page.get_by_text("Ajustar").click()
    resized = rel_center(page, f"annotation-{mid}")
    assert abs(resized[0] - before_marker[0]) < TOL and abs(resized[1] - before_marker[1]) < TOL
    page.close()


def test_multipage_and_focus(browser):
    b, _ = browser
    page = b.new_page(viewport={"width": 1100, "height": 900})
    open_viewer(page)
    expect(page.get_by_test_id("page-indicator")).to_have_text("Pàgina 1 de 2")
    expect(page.get_by_test_id("annotation-arq-1")).to_have_count(0)   # és de la pàgina 2

    # "Veure al plànol": canvia de pàgina, amplia i centra el marcador
    page.get_by_test_id("focus-arq-1").click()
    expect(page.get_by_test_id("page-indicator")).to_have_text("Pàgina 2 de 2")
    expect(page.get_by_test_id("annotation-arq-1")).to_be_visible()
    page.wait_for_timeout(300)
    assert zoom_pct(page) >= 200
    c = page.get_by_test_id("plan-container").bounding_box()
    m = page.get_by_test_id("annotation-arq-1").bounding_box()
    assert abs((m["x"] + m["width"] / 2) - (c["x"] + c["width"] / 2)) < 25
    assert abs((m["y"] + m["height"] / 2) - (c["y"] + c["height"] / 2)) < 25

    # Anotació a la pàgina 2: es desa amb la pàgina correcta
    page.get_by_text("Ajustar").click()
    page.locator("[data-mode=punt]").first.click()
    page.mouse.click(*at(page, 0.2, 0.2))
    assert annotations(page)[-1]["page"] == 2

    # Clic sobre un marcador existent el selecciona i no en crea un de nou
    n = len(annotations(page))
    page.get_by_test_id("annotation-arq-1").click()
    expect(page.get_by_test_id("selected")).to_have_text("arq-1")
    assert len(annotations(page)) == n
    page.close()


def touch(cdp, kind, points):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})


def test_mobile_gestures_do_not_create_accidental_annotations(browser):
    b, p = browser
    ctx = b.new_context(**p.devices["iPhone 13"])
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    open_viewer(page)

    # Navegació amb un dit: no crea anotacions
    x, y = at(page, 0.5, 0.5)
    touch(cdp, "touchStart", [(x, y)])
    for k in range(1, 8):
        touch(cdp, "touchMove", [(x - 10 * k, y - 6 * k)])
    touch(cdp, "touchEnd", [])
    assert annotations(page) == []

    # Pessic amb dos dits: amplia
    cx, cy = at(page, 0.5, 0.4)
    touch(cdp, "touchStart", [(cx - 30, cy), (cx + 30, cy)])
    for k in range(1, 10):
        touch(cdp, "touchMove", [(cx - 30 - 12 * k, cy), (cx + 30 + 12 * k, cy)])
    touch(cdp, "touchEnd", [])
    assert zoom_pct(page) > 150
    assert annotations(page) == []

    # Mode marcador: un toc crea el marcador a la posició exacta, amb zoom aplicat
    page.locator("[data-mode=punt]").first.tap()
    tx, ty = at(page, 0.45, 0.42)
    page.touchscreen.tap(tx, ty)
    anns = annotations(page)
    assert len(anns) == 1
    assert abs(anns[0]["x"] - 0.45) < TOL and abs(anns[0]["y"] - 0.42) < TOL

    # En mode marcador, un pessic tampoc crea anotacions
    cx, cy = at(page, 0.5, 0.5)
    touch(cdp, "touchStart", [(cx - 40, cy), (cx + 40, cy)])
    for k in range(1, 6):
        touch(cdp, "touchMove", [(cx - 40 - 8 * k, cy), (cx + 40 + 8 * k, cy)])
    touch(cdp, "touchEnd", [])
    assert len(annotations(page)) == 1

    # Marcadors fàcils de prémer: mida mínima en pantalla
    mb = page.get_by_test_id(f"annotation-{anns[0]['id']}").bounding_box()
    assert mb["width"] >= 30 and mb["height"] >= 30
    page.screenshot(path=os.environ.get("SHOT_DIR", "/tmp") + "/visor-mobil.png")
    ctx.close()


def test_image_documents(browser):
    b, _ = browser
    page = b.new_page(viewport={"width": 1000, "height": 800})
    open_viewer(page, img=True)
    page.locator("[data-mode=punt]").first.click()
    page.mouse.click(*at(page, 0.25, 0.75))
    a = annotations(page)[-1]
    assert abs(a["x"] - 0.25) < TOL and abs(a["y"] - 0.75) < TOL
    page.screenshot(path=os.environ.get("SHOT_DIR", "/tmp") + "/visor-imatge.png")
    page.close()


def test_workspace_create_and_select(browser):
    """Espai de treball: crear un marcador obre el formulari; seleccionar-ne un mostra el fil i els adjunts."""
    b, p = browser
    for name, opts in (("escriptori", {"viewport": {"width": 1400, "height": 950}}), ("mobil", p.devices["iPhone 13"])):
        ctx = b.new_context(**opts)
        page = ctx.new_page()
        page.goto(f"{BASE}/proves/espai")
        expect(page.get_by_text("Carregant el document…")).to_have_count(0, timeout=15000)
        page.wait_for_function("document.querySelector('[data-testid=plan-page]').getBoundingClientRect().height > 50")
        # Seleccionar el marcador 1: panell amb comentari, adjunt i fil (inclosa la nota interna marcada)
        page.get_by_test_id("annotation-a1").click()
        panel = page.get_by_test_id("annotation-panel")
        expect(panel).to_contain_text("Vull que aquesta finestra sigui més ampla")
        expect(panel).to_contain_text("Pot ser corredissa?")
        expect(panel).to_contain_text("Intern")
        expect(panel.get_by_role("img", name="Finestra de referència")).to_be_visible()
        # Crear un marcador nou: s'obre el formulari amb la vinculació al punt i la resposta al marcador seleccionat
        page.locator("[data-mode=punt]").first.click()
        page.mouse.click(*at(page, 0.6, 0.5)) if name == "escriptori" else page.touchscreen.tap(*at(page, 0.6, 0.5))
        dialog = page.get_by_role("dialog", name="Nou marcador")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_text("Resposta al marcador 1")).to_be_visible()
        dialog.get_by_text("Cancel·lar").click()
        expect(dialog).to_have_count(0)
        page.screenshot(path=os.environ.get("SHOT_DIR", "/tmp") + f"/espai-{name}.png", full_page=True)
        ctx.close()


def test_confirmation_thumbnails_and_double_click(browser):
    """Confirmació: miniatures amb el marcador a la posició correcta i enviament protegit contra el doble clic."""
    b, _ = browser
    page = b.new_page(viewport={"width": 900, "height": 900})
    posts = []
    page.on("request", lambda r: posts.append(r.post_data or "") if r.method == "POST" and r.headers.get("next-action") else None)
    page.goto(f"{BASE}/proves/confirmacio")
    page.wait_for_timeout(1500)
    # La miniatura PDF s'ha renderitzat i el marcador 1 és al 40 % / 30 %
    thumbs = page.locator("[data-testid=confirm-item] canvas")
    expect(thumbs.first).to_be_visible()
    box = thumbs.first.bounding_box()
    label = page.get_by_text("1", exact=True).nth(1).bounding_box()
    cx = (label["x"] + label["width"] / 2 - box["x"]) / box["width"]
    cy = (label["y"] + label["height"] / 2 - box["y"]) / box["height"]
    assert abs(cx - 0.40) < 0.03 and abs(cy - 0.30) < 0.03, (cx, cy)

    send = page.get_by_test_id("confirm-send")
    expect(send).to_be_disabled()                      # cal marcar la casella abans
    page.get_by_test_id("confirm-check").check()
    expect(send).to_be_enabled()
    send.dblclick()
    page.wait_for_timeout(1500)
    keys = {k for body in posts for k in __import__("re").findall(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", body)}
    assert len(posts) >= 1
    assert len(keys) == 1, f"s'han enviat claus diferents: {keys}"   # mateixa clau d'idempotència
    page.screenshot(path=os.environ.get("SHOT_DIR", "/tmp") + "/confirmacio.png", full_page=True)
    page.close()
