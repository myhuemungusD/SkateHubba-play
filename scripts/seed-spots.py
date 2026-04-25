#!/usr/bin/env python3
"""Collect public skatepark location data and emit a normalized GeoJSON seed.

One-shot seed tool. Not part of the build or runtime — Python is required only
to regenerate the data. Output is gitignored under scripts/output/.

Sources (priority order):
  1. Overpass API (OpenStreetMap) — primary
  2. Wikidata SPARQL — enrichment
  3. The Skatepark Project — supplemental (only if a JSON endpoint is exposed)

Run: python3 scripts/seed-spots.py
Output: scripts/output/skatehubba-spots-seed.geojson
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "scripts" / "output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

OUT_PATH = OUT_DIR / "skatehubba-spots-seed.geojson"
RAW_OSM = OUT_DIR / "_raw-osm.json"
RAW_WD = OUT_DIR / "_raw-wikidata.json"
RAW_TSPP = OUT_DIR / "_raw-tspp.json"

# Wikimedia User-Agent policy: ApplicationName/version (URL or contact).
# https://meta.wikimedia.org/wiki/User-Agent_policy
USER_AGENT = (
    "SkateHubbaSeedBot/1.0 "
    "(+https://github.com/myhuemungusd/skatehubba-play; one-shot seed import)"
)

ATTRIBUTION = {
    "osm": "© OpenStreetMap contributors (ODbL)",
    "wikidata": "Wikidata (CC0)",
    "skateparkproject": "The Skatepark Project",
}

# Public Overpass endpoints. Tried in order — first 2xx wins.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
# US bounding box split into tiles so each Overpass query finishes within the
# server-side timeout. The full US (24.5..49.5 lat, -125..-66.9 lon) is too big
# for a single query and Overpass returns an empty response with a "remark".
US_BBOX = (24.5, -125.0, 49.5, -66.9)
OVERPASS_TILE_ROWS = 4  # lat
OVERPASS_TILE_COLS = 4  # lon

OVERPASS_QUERY_TEMPLATE = """[out:json][timeout:120];
(
  node["sport"="skateboard"]({bbox});
  way["sport"="skateboard"]({bbox});
  relation["sport"="skateboard"]({bbox});
  node["leisure"="pitch"]["sport"="skateboard"]({bbox});
  way["leisure"="pitch"]["sport"="skateboard"]({bbox});
);
out center tags;
"""

WIKIDATA_URL = "https://query.wikidata.org/sparql"
WIKIDATA_QUERY = """SELECT ?item ?itemLabel ?coord ?countryLabel ?inception ?image WHERE {
  ?item wdt:P31 wd:Q1066301.
  ?item wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""

TSPP_HOMEPAGES = [
    "https://publicskateparkguide.org/",
    "https://skatepark.org/skateparks",
]


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

class DomainThrottle:
    """Enforces max 1 request per second per domain."""

    def __init__(self) -> None:
        self._last: dict[str, float] = {}

    def wait(self, url: str) -> None:
        host = urllib.parse.urlsplit(url).hostname or ""
        now = time.time()
        prev = self._last.get(host, 0.0)
        delta = now - prev
        if delta < 1.0:
            time.sleep(1.0 - delta)
        self._last[host] = time.time()


THROTTLE = DomainThrottle()


def http_request(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> tuple[int, bytes, dict[str, str]]:
    THROTTLE.wait(url)
    req_headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        return e.code, body, dict(e.headers or {})


def fetch_with_retry(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> bytes | None:
    """Fetch with one 5-second retry on 4xx/5xx or transport errors."""

    for attempt in range(2):
        try:
            status, body, _ = http_request(
                url, method=method, data=data, headers=headers, timeout=timeout
            )
            if 200 <= status < 300:
                return body
            sys.stderr.write(
                f"[warn] {method} {url} -> HTTP {status} (attempt {attempt + 1})\n"
            )
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            sys.stderr.write(
                f"[warn] {method} {url} -> {type(e).__name__}: {e} (attempt {attempt + 1})\n"
            )
        if attempt == 0:
            time.sleep(5)
    return None


# ---------------------------------------------------------------------------
# Source: Overpass / OSM
# ---------------------------------------------------------------------------

def _tile_bboxes(bbox: tuple[float, float, float, float], rows: int, cols: int):
    s, w, n, e = bbox
    lat_step = (n - s) / rows
    lon_step = (e - w) / cols
    for r in range(rows):
        for c in range(cols):
            south = s + r * lat_step
            north = s + (r + 1) * lat_step if r < rows - 1 else n
            west = w + c * lon_step
            east = w + (c + 1) * lon_step if c < cols - 1 else e
            yield (round(south, 4), round(west, 4), round(north, 4), round(east, 4))


def _post_overpass(query: str) -> dict[str, Any] | None:
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    for url in OVERPASS_URLS:
        raw = fetch_with_retry(
            url, method="POST", data=body, headers=headers, timeout=180
        )
        if not raw:
            continue
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            sys.stderr.write(f"[osm]   {url} non-JSON response: {e}\n")
            continue
        # Overpass signals server-side errors via a top-level "remark" field
        # while still returning 200 with elements=[]. Treat those as failure.
        remark = payload.get("remark")
        if remark and not payload.get("elements"):
            sys.stderr.write(f"[osm]   {url} remark: {remark}\n")
            continue
        return payload
    return None


def fetch_osm() -> list[dict[str, Any]]:
    tiles = list(_tile_bboxes(US_BBOX, OVERPASS_TILE_ROWS, OVERPASS_TILE_COLS))
    sys.stderr.write(f"[osm] querying Overpass in {len(tiles)} tiles...\n")
    seen: set[tuple[str, int]] = set()
    combined: list[dict[str, Any]] = []
    all_raw: list[dict[str, Any]] = []
    for idx, (s, w, n, e) in enumerate(tiles, 1):
        bbox_str = f"{s},{w},{n},{e}"
        query = OVERPASS_QUERY_TEMPLATE.format(bbox=bbox_str)
        sys.stderr.write(f"[osm]  tile {idx}/{len(tiles)} bbox={bbox_str} ... ")
        payload = _post_overpass(query)
        if payload is None:
            sys.stderr.write("FAILED\n")
            continue
        elements = payload.get("elements", []) or []
        kept = 0
        for el in elements:
            key = (el.get("type", ""), int(el.get("id", 0)))
            if key in seen:
                continue
            seen.add(key)
            combined.append(el)
            kept += 1
        all_raw.append({"bbox": bbox_str, "elements": elements})
        sys.stderr.write(f"{len(elements)} elements ({kept} new)\n")
    if not combined:
        sys.stderr.write("[osm] FAILED — no elements collected\n")
        return []
    RAW_OSM.write_text(json.dumps({"tiles": all_raw}, ensure_ascii=False), encoding="utf-8")
    sys.stderr.write(f"[osm] combined unique elements: {len(combined)}\n")
    return combined


def normalize_osm(elements: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for el in elements:
        if el.get("type") == "node":
            lat = el.get("lat")
            lon = el.get("lon")
        else:
            center = el.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            continue
        if lat_f == 0 and lon_f == 0:
            continue
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
            continue
        tags = el.get("tags") or {}
        name = (tags.get("name") or tags.get("alt_name") or "").strip()
        if not name:
            # Some skateparks lack a name tag; synthesize a stable label so the
            # feature is still useful for seeding (operator + city, else bare id).
            operator = tags.get("operator") or ""
            city = tags.get("addr:city") or tags.get("is_in:city") or ""
            label = " ".join(p for p in (operator, city) if p).strip()
            name = label or f"Skatepark (OSM {el.get('type')}/{el.get('id')})"

        surface = tags.get("surface")
        access = tags.get("access")
        lit_raw = tags.get("lit")
        lit: bool | None
        if lit_raw in ("yes", "true", "1"):
            lit = True
        elif lit_raw in ("no", "false", "0"):
            lit = False
        else:
            lit = None
        opened = tags.get("start_date") or tags.get("opening_date")
        opened_year = parse_year(opened)
        country = tags.get("addr:country")
        city = tags.get("addr:city")
        source_id = f"{el.get('type')}/{el.get('id')}"
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon_f, lat_f]},
            "properties": {
                "name": name,
                "type": "park",
                "source": "osm",
                "sourceId": source_id,
                "country": country,
                "city": city,
                "surface": surface,
                "lit": lit,
                "access": access,
                "openedYear": opened_year,
                "attribution": ATTRIBUTION["osm"],
            },
        })
    return out


# ---------------------------------------------------------------------------
# Source: Wikidata
# ---------------------------------------------------------------------------

def fetch_wikidata() -> dict[str, Any] | None:
    sys.stderr.write("[wikidata] querying SPARQL endpoint...\n")
    qs = urllib.parse.urlencode({"query": WIKIDATA_QUERY, "format": "json"})
    url = f"{WIKIDATA_URL}?{qs}"
    raw = fetch_with_retry(url, headers={"Accept": "application/sparql-results+json"})
    if not raw:
        sys.stderr.write("[wikidata] FAILED — skipping\n")
        return None
    RAW_WD.write_bytes(raw)
    return json.loads(raw.decode("utf-8"))


_POINT_RE = re.compile(r"^\s*Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$")


def normalize_wikidata(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not payload:
        return []
    rows = payload.get("results", {}).get("bindings", [])
    out: list[dict[str, Any]] = []
    for row in rows:
        coord = (row.get("coord") or {}).get("value", "")
        m = _POINT_RE.match(coord)
        if not m:
            continue
        lon_f, lat_f = float(m.group(1)), float(m.group(2))
        if lat_f == 0 and lon_f == 0:
            continue
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
            continue
        item_iri = (row.get("item") or {}).get("value", "")
        qid = item_iri.rsplit("/", 1)[-1] if item_iri else ""
        if not qid:
            continue
        name = (row.get("itemLabel") or {}).get("value") or qid
        country = (row.get("countryLabel") or {}).get("value") or None
        inception = (row.get("inception") or {}).get("value") or None
        opened_year = parse_year(inception)
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon_f, lat_f]},
            "properties": {
                "name": name.strip(),
                "type": "park",
                "source": "wikidata",
                "sourceId": qid,
                "country": country,
                "city": None,
                "surface": None,
                "lit": None,
                "access": None,
                "openedYear": opened_year,
                "attribution": ATTRIBUTION["wikidata"],
            },
        })
    return out


# ---------------------------------------------------------------------------
# Source: The Skatepark Project (supplemental, JSON-endpoint-only)
# ---------------------------------------------------------------------------

_TSPP_JSON_HINTS = re.compile(
    r"""(?:["'])(/[^"']*?(?:skatepark|park|location|map)[^"']*?\.(?:json|geojson)[^"']*)(?:["'])""",
    re.IGNORECASE,
)


def fetch_tspp() -> list[dict[str, Any]]:
    sys.stderr.write("[tspp] probing for public JSON endpoint...\n")
    for home in TSPP_HOMEPAGES:
        raw = fetch_with_retry(home, timeout=30)
        if not raw:
            continue
        html = raw.decode("utf-8", errors="replace")
        candidates = set(_TSPP_JSON_HINTS.findall(html))
        for path in candidates:
            url = urllib.parse.urljoin(home, path)
            sys.stderr.write(f"[tspp] candidate JSON: {url}\n")
            data = fetch_with_retry(url, timeout=30)
            if not data:
                continue
            try:
                payload = json.loads(data.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                continue
            RAW_TSPP.write_bytes(data)
            return normalize_tspp(payload)
    sys.stderr.write("[tspp] no public JSON endpoint discovered — skipping\n")
    return []


def normalize_tspp(payload: Any) -> list[dict[str, Any]]:
    """Best-effort normalization for an unknown JSON shape.

    We accept either a list of records or a dict containing one. Each record
    must yield a lat/lng and a name; otherwise it's dropped.
    """
    records: list[dict[str, Any]] = []
    if isinstance(payload, list):
        records = [r for r in payload if isinstance(r, dict)]
    elif isinstance(payload, dict):
        for key in ("parks", "skateparks", "results", "data", "features", "items"):
            v = payload.get(key)
            if isinstance(v, list):
                records = [r for r in v if isinstance(r, dict)]
                break
    out: list[dict[str, Any]] = []
    for rec in records:
        # Try common coord shapes.
        lat = rec.get("lat") or rec.get("latitude")
        lon = rec.get("lng") or rec.get("lon") or rec.get("longitude")
        if lat is None or lon is None:
            geom = rec.get("geometry") or {}
            coords = geom.get("coordinates") if isinstance(geom, dict) else None
            if isinstance(coords, list) and len(coords) >= 2:
                lon, lat = coords[0], coords[1]
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            continue
        if lat_f == 0 and lon_f == 0:
            continue
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
            continue
        name = (
            rec.get("name")
            or rec.get("title")
            or (rec.get("properties") or {}).get("name")
            or ""
        )
        if not isinstance(name, str) or not name.strip():
            continue
        source_id = str(
            rec.get("id")
            or rec.get("slug")
            or (rec.get("properties") or {}).get("id")
            or name
        )
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon_f, lat_f]},
            "properties": {
                "name": name.strip(),
                "type": "park",
                "source": "skateparkproject",
                "sourceId": source_id,
                "country": rec.get("country") or None,
                "city": rec.get("city") or None,
                "surface": rec.get("surface") or None,
                "lit": None,
                "access": rec.get("access") or None,
                "openedYear": parse_year(rec.get("opened") or rec.get("year")),
                "attribution": ATTRIBUTION["skateparkproject"],
            },
        })
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_YEAR_RE = re.compile(r"(\d{4})")


def parse_year(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        y = int(value)
        return y if 1800 <= y <= 2100 else None
    s = str(value)
    m = _YEAR_RE.search(s)
    if not m:
        return None
    y = int(m.group(1))
    return y if 1800 <= y <= 2100 else None


_PUNCT_RE = re.compile(r"[^a-z0-9\s]")
_WS_RE = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    s = name.lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def name_similarity(a: str, b: str) -> float:
    """Jaccard similarity over normalized token sets — cheap and good enough."""
    ta = set(normalize_name(a).split())
    tb = set(normalize_name(b).split())
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Dedupe
# ---------------------------------------------------------------------------

SOURCE_PRIORITY = {"osm": 0, "wikidata": 1, "skateparkproject": 2}


@dataclass
class Stats:
    osm: int = 0
    wikidata: int = 0
    skateparkproject: int = 0
    merged: int = 0
    dropped_invalid: int = 0
    dropped_dup_id: int = 0


def dedupe(features: list[dict[str, Any]], stats: Stats) -> list[dict[str, Any]]:
    # Stage 1: drop exact duplicate (source, sourceId).
    seen_ids: set[tuple[str, str]] = set()
    pass1: list[dict[str, Any]] = []
    for f in features:
        p = f["properties"]
        key = (p["source"], p["sourceId"])
        if key in seen_ids:
            stats.dropped_dup_id += 1
            continue
        seen_ids.add(key)
        pass1.append(f)

    # Stage 2: cross-source merge within 50 m AND name similarity >= 0.85.
    # OSM is canonical when present.
    pass1.sort(key=lambda f: SOURCE_PRIORITY.get(f["properties"]["source"], 99))
    merged: list[dict[str, Any]] = []
    for cand in pass1:
        cp = cand["properties"]
        c_lon, c_lat = cand["geometry"]["coordinates"]
        match_idx = -1
        for i, kept in enumerate(merged):
            kp = kept["properties"]
            if kp["source"] == cp["source"]:
                continue  # same source already deduped by id
            k_lon, k_lat = kept["geometry"]["coordinates"]
            if haversine_m(c_lat, c_lon, k_lat, k_lon) > 50:
                continue
            if name_similarity(cp["name"], kp["name"]) < 0.85:
                continue
            match_idx = i
            break
        if match_idx == -1:
            merged.append(cand)
            continue
        # Merge enrichment fields into the canonical (kept) record.
        kept = merged[match_idx]
        kp = kept["properties"]
        for field_name in ("country", "city", "surface", "access", "openedYear", "lit"):
            if kp.get(field_name) in (None, "") and cp.get(field_name) not in (None, ""):
                kp[field_name] = cp[field_name]
        merged_sources = kp.setdefault("mergedSources", [])
        merged_sources.append({"source": cp["source"], "sourceId": cp["sourceId"]})
        stats.merged += 1
    return merged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def compute_bbox(features: list[dict[str, Any]]) -> list[float] | None:
    if not features:
        return None
    lons = [f["geometry"]["coordinates"][0] for f in features]
    lats = [f["geometry"]["coordinates"][1] for f in features]
    return [min(lons), min(lats), max(lons), max(lats)]


def main() -> int:
    started = time.time()
    deadline = started + 30 * 60

    # 1. OSM
    osm_elements = fetch_osm()
    osm_features = normalize_osm(osm_elements) if time.time() < deadline else []

    # 2. Wikidata
    if time.time() < deadline:
        wd_payload = fetch_wikidata()
        wd_features = normalize_wikidata(wd_payload)
    else:
        wd_features = []

    # 3. Skatepark Project (only if JSON endpoint exists)
    if time.time() < deadline:
        tspp_features = fetch_tspp()
    else:
        tspp_features = []

    stats = Stats(
        osm=len(osm_features),
        wikidata=len(wd_features),
        skateparkproject=len(tspp_features),
    )

    all_features = osm_features + wd_features + tspp_features
    deduped = dedupe(all_features, stats)

    # Drop already counted invalid features at normalize-time; nothing else to drop here.
    total = len(deduped)
    bbox = compute_bbox(deduped)

    fc: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": deduped,
    }
    if bbox:
        fc["bbox"] = bbox

    OUT_PATH.write_text(json.dumps(fc, indent=2, ensure_ascii=False), encoding="utf-8")

    summary = {
        "total": total,
        "perSource": {
            "osm": stats.osm,
            "wikidata": stats.wikidata,
            "skateparkproject": stats.skateparkproject,
        },
        "merged": stats.merged,
        "droppedDuplicateIds": stats.dropped_dup_id,
        "bbox": bbox,
        "elapsedSeconds": round(time.time() - started, 1),
        "outputPath": str(OUT_PATH),
    }
    sys.stderr.write("\n=== SUMMARY ===\n")
    sys.stderr.write(json.dumps(summary, indent=2) + "\n")
    sys.stderr.write("\n=== FIRST 3 FEATURES ===\n")
    sys.stderr.write(json.dumps(deduped[:3], indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
