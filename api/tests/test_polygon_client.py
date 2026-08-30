"""Paginación del cliente de Polygon.

`get_json` con limit=50000 trunca en silencio: 60 días de barras de un minuto
la superan, y el modelo se entrenaría con un recorte que nadie ve.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import polygon_client


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    """Cada test parte de una caché vacía y sin esperas de rate-limit."""
    polygon_client._cache.clear()
    monkeypatch.setattr(polygon_client, "_throttle", lambda: None)


class _Response:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _fake_get(pages):
    """Sirve `pages` en orden y registra las URLs pedidas."""
    calls = []

    def get(url, timeout=30):
        calls.append(url)
        return _Response(pages[len(calls) - 1])

    return get, calls


def test_sigue_next_url_y_acumula_resultados(monkeypatch):
    pages = [
        {"results": [1, 2], "next_url": "https://api.polygon.io/next?cursor=a"},
        {"results": [3, 4], "next_url": "https://api.polygon.io/next?cursor=b"},
        {"results": [5]},
    ]
    get, calls = _fake_get(pages)
    monkeypatch.setattr(polygon_client.requests, "get", get)

    out = polygon_client.get_paginated("https://api.polygon.io/first?apiKey=K")

    assert out["results"] == [1, 2, 3, 4, 5]
    assert out["pages"] == 3
    assert out["truncated"] is False
    assert len(calls) == 3


def test_anade_la_api_key_al_next_url(monkeypatch):
    pages = [
        {"results": [1], "next_url": "https://api.polygon.io/next?cursor=a"},
        {"results": [2]},
    ]
    get, calls = _fake_get(pages)
    monkeypatch.setattr(polygon_client.requests, "get", get)

    polygon_client.get_paginated("https://api.polygon.io/first?apiKey=SECRETO")

    # Polygon no propaga la clave en next_url: hay que volver a ponerla.
    assert "apiKey=SECRETO" in calls[1]


def test_para_en_el_tope_y_lo_marca(monkeypatch):
    # Cursores distintos a propósito: `get_json` cachea por URL, así que
    # repetir el mismo next_url serviría la página anterior desde caché y la
    # cuenta de llamadas no reflejaría lo que hace el bucle.
    pages = [{"results": [i], "next_url": f"https://api.polygon.io/next?cursor={i}"}
             for i in range(10)]
    get, calls = _fake_get(pages)
    monkeypatch.setattr(polygon_client.requests, "get", get)

    out = polygon_client.get_paginated("https://api.polygon.io/first?apiKey=K", max_pages=3)

    assert out["pages"] == 3
    assert out["truncated"] is True
    assert len(calls) == 3


def test_una_sola_pagina_sin_next_url(monkeypatch):
    get, _ = _fake_get([{"results": [1, 2, 3]}])
    monkeypatch.setattr(polygon_client.requests, "get", get)

    out = polygon_client.get_paginated("https://api.polygon.io/first?apiKey=K")

    assert out["results"] == [1, 2, 3]
    assert out["truncated"] is False


def test_respuesta_sin_results(monkeypatch):
    get, _ = _fake_get([{"status": "OK"}])
    monkeypatch.setattr(polygon_client.requests, "get", get)

    assert polygon_client.get_paginated("https://api.polygon.io/f?apiKey=K")["results"] == []
