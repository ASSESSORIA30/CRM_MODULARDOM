"""
Comparació WEB ↔ CRM: obre la còpia exacta del configurador web (tests/web-reference/original) en un
navegador, hi introdueix moltes configuracions i compara cada línia, la base imposable, els IVA i el total
que mostra la pantalla amb el motor del CRM (/proves/motor).

    BASE_URL=http://localhost:3103 python3 -m pytest -q tests/e2e/test_web_vs_crm.py

La web mostra euros arrodonits; el CRM calcula en cèntims. Les línies i la base han de coincidir exactament;
els IVA i el total, en euros arrodonits com a la pantalla.
"""
import functools
import http.server
import json
import os
import random
import re
import threading
import urllib.parse
import urllib.request

import pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3103")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
WEB_DIRS = {
    "original": os.path.join(ROOT, "tests", "web-reference", "original"),   # web actual (v3)
    "integrada": os.path.join(ROOT, "web-integracio"),                     # web amb el motor i la tarifa del CRM
}
TARIFF_JS = "https://crmmodulardom.vercel.app/api/configurador/tarifa.js"
SUITES = ["sin", "bano", "bano_vestidor"]
KITCHENS = ["basica", "isla"]
INST = ["aerotermia", "aireConductos"]
EXTRAS = ["piscina", "porche", "placasSolares"]


def configs():
    rnd = random.Random(20261117)
    out = [
        dict(metres=100, habitacions=1, banys=1, suite="sin", cuina="basica", vehicles=0, safareig=False, installacions=[], extres=[]),
        dict(metres=300, habitacions=6, banys=4, suite="bano_vestidor", cuina="isla", vehicles=4, safareig=True, installacions=INST, extres=EXTRAS),
        dict(metres=150, habitacions=3, banys=2, suite="bano", cuina="isla", vehicles=1, safareig=False, installacions=["aerotermia"], extres=["piscina"]),
        dict(metres=137, habitacions=2, banys=1, suite="sin", cuina="basica", vehicles=2, safareig=True, installacions=["aireConductos"], extres=[]),
    ]
    for _ in range(36):
        out.append(dict(
            metres=rnd.choice([100, 120, 150, 180, 200, 250, 300, rnd.randint(100, 420)]),
            habitacions=rnd.randint(1, 6), banys=rnd.randint(1, 4), suite=rnd.choice(SUITES), cuina=rnd.choice(KITCHENS),
            vehicles=rnd.randint(0, 4), safareig=rnd.random() < 0.5,
            installacions=[k for k in INST if rnd.random() < 0.4], extres=[k for k in EXTRAS if rnd.random() < 0.4],
        ))
    return out


def euros(text):
    return int(re.sub(r"[^0-9-]", "", text or "0") or 0)


def rounded(cents):
    # Math.round(euros) de la web (valors positius)
    return (cents + 50) // 100


def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


@pytest.fixture(scope="module", params=list(WEB_DIRS))
def web(request):
    srv = serve(WEB_DIRS[request.param])
    yield f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def new_page(browser, tariff=None):
    pg = browser.new_page()
    # La tarifa publicada del CRM: per defecte "encara no publicada" (la web fa servir la de reserva)
    body = f"window.MODULARDOM_TARIFA = {json.dumps({'number': 9, 'params': tariff}) if tariff else 'null'};"
    pg.route(TARIFF_JS, lambda route: route.fulfill(status=200, content_type="application/javascript", body=body))
    return pg


@pytest.fixture(scope="module")
def page(browser):
    pg = new_page(browser)
    yield pg
    pg.close()


def web_result(page, url, c):
    page.goto(url)
    page.evaluate("localStorage.clear()")
    page.goto(url)
    page.evaluate("""(c) => {
      document.getElementById('startBtn').click();
      const inp = document.getElementById('areaInput');
      inp.value = String(c.metres); inp.dispatchEvent(new Event('input', {bubbles: true}));
      const click = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error('no ' + sel); el.click(); };
      click(`[data-room="${c.habitacions}"]`); click(`[data-bath="${c.banys}"]`);
      click(`[data-suite="${c.suite}"]`); click(`[data-cocina="${c.cuina}"]`);
      click(`[data-vehiculos="${c.vehicles}"]`);
      if (c.safareig) click('[data-lavadero]');
      c.installacions.forEach(k => click(`[data-extram2="${k}"]`));
      c.extres.forEach(k => click(`[data-extra="${k}"]`));
    }""", c)
    page.wait_for_timeout(60)
    rows = page.evaluate("""() => [...document.querySelectorAll('#asideLines .bline')].map(r => {
        const label = r.querySelector('span').childNodes[0].textContent.trim();
        const strong = r.querySelector('strong');
        return [label, (strong || r.querySelector('span:last-child')).textContent];
    })""")
    get = lambda i: page.text_content(i)
    return {
        "lines": [(lbl, euros(v)) for lbl, v in rows],
        "subtotal": euros(get("#asideSubtotal")), "ivaObra": euros(get("#asideIvaObra")),
        "ivaArq": euros(get("#asideIvaArq")), "total": euros(get("#asideTotal")),
    }


def crm_result(c, tariff=None):
    q = f"cfg={urllib.parse.quote(json.dumps(c))}" + (f"&tarifa={urllib.parse.quote(json.dumps(tariff))}" if tariff else "")
    with urllib.request.urlopen(f"{BASE}/proves/motor?{q}") as r:
        return json.load(r)


def compare(w, r):
    crm_lines = []
    for l in r["lines"]:
        lbl = l["label"]["ca"]
        crm_lines.append((lbl, l["amountCents"] // 100))
        assert l["amountCents"] % 100 == 0, l  # tots els imports de línia són euros enters
    assert w["lines"] == crm_lines
    assert w["subtotal"] * 100 == r["subtotalCents"]
    assert w["ivaObra"] == rounded(r["ivaObraCents"])
    assert w["ivaArq"] == rounded(r["ivaArqCents"])
    # La pantalla suma l'IVA d'obra ja arrodonit (pegat de l'index.html): pot diferir 1 € del total exacte
    exact = rounded(r["totalCents"])
    screen_formula = w["subtotal"] + w["ivaObra"] + r["ivaArqCents"] / 100
    assert w["total"] in (exact, round(screen_formula + 1e-9)), (w["total"], exact)


@pytest.mark.parametrize("c", configs(), ids=lambda c: f"{c['metres']}m2-h{c['habitacions']}-b{c['banys']}-{c['suite']}-{c['cuina']}-g{c['vehicles']}")
def test_same_result(web, page, c):
    compare(web_result(page, web, c), crm_result(c))


def lead_total(page):
    # Completa el formulari de contacte (dades fictícies) i llegeix el total que la web desa amb el lead
    page.evaluate("""() => {
      document.getElementById('leadName').value = 'Persona de prova';
      document.getElementById('leadPhone').value = '600000000';
      document.getElementById('leadEmail').value = 'prova@example.com';
      document.getElementById('leadSubmit').click();
    }""")
    page.wait_for_timeout(200)
    return page.evaluate("""() => { const k = Object.keys(localStorage).find(k => k.startsWith('modulardom_lead_'));
      return JSON.parse(localStorage.getItem(k)).config.total; }""")


def test_lead_and_pdf_total_match_screen(browser):
    """A la web original, el total del lead i del PDF inclou els 2.800 € que la pantalla no mostra. A la integrada, no."""
    c = configs()[2]
    out = {}
    for name, d in WEB_DIRS.items():
        srv = serve(d)
        pg = new_page(browser)
        url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
        w = web_result(pg, url, c)
        out[name] = (w["total"], round(lead_total(pg)))
        pg.close(); srv.shutdown()
    screen, lead = out["original"]
    assert lead - screen == round(2800 * 1.21)  # error de la web actual: 2.800 € + IVA 21 %
    screen, lead = out["integrada"]
    assert lead == screen


def test_published_tariff_changes_the_web(browser):
    """Quan direcció publica una tarifa nova al CRM, la web integrada calcula amb aquella tarifa (mateix resultat que el CRM)."""
    tariff = json.loads(json.dumps(TARIFF_V1))
    tariff["construccio_m2"] = 1010
    tariff["extres"]["pergola"] = {"nom": {"ca": "Pèrgola", "es": "Pérgola"}, "preu": 4200}
    srv = serve(WEB_DIRS["integrada"])
    pg = new_page(browser, tariff)
    c = dict(configs()[2], extres=["pergola", "piscina"])
    w = web_result(pg, f"http://127.0.0.1:{srv.server_address[1]}/index.html", c)
    compare(w, crm_result(c, tariff))
    assert ("Construcció", 151500) in w["lines"]
    pg.close(); srv.shutdown()


TARIFF_V1 = json.loads(open(os.path.join(ROOT, "supabase", "migrations", "20261117001100_pressupostos_v2.sql")).read().split("$json$")[1])
