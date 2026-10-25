"""
Saves the TodayTix seating chart SVG of a show's performance to scripts/seatmaps/raw/<id>.todaytix.svg, for the venue
scripts that read it (see todaytix.mjs). Needs Python playwright with chromium.

  python3 scripts/seatmaps/capture-todaytix.py <id>=<showId> [<id>=<showId> …]

<showId> is the number in the show's todaytix.com/london/shows/<showId> URL. Any show at the venue will do, and the first
performance with a chart is used (a TodayTix chart lists every seat, sold ones too).
"""
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

RAW = Path(__file__).parent / 'raw'


def showtimes(show):
    with urllib.request.urlopen(f'https://api.todaytix.com/api/v2/shows/{show}/showtimes?includeNoInventory=false', timeout=30) as r:
        return json.load(r)['data']


def capture(browser, name, show):
    times = [t for t in showtimes(show) if t['localDate'] >= date.today().isoformat()]
    if not times:
        raise RuntimeError(f'no performances for show {show}')
    detail = json.load(urllib.request.urlopen(f'https://api.todaytix.com/api/v2/shows?id={show}&fieldset=SHOW_SUMMARY&limit=1', timeout=30))['data'][0]
    for t in times[len(times) // 3 :][:3] or times[:3]:
        url = (f"https://www.todaytix.com/booking/seating-plan?product_id={show}&content_product_id={show}&venue_id={detail['venueId']}"
               f"&product_type=show&qt=2&showtime_id={t['id']}&slot={t['localTime']}&date={t['localDate']}")
        page = browser.new_page(viewport={'width': 1400, 'height': 1000})
        try:
            page.goto(url, wait_until='domcontentloaded', timeout=60000)
            page.wait_for_selector('#svg-canvas rect[data-test-id^="seat-"]', timeout=30000)
            page.wait_for_timeout(1500)
            svg = page.evaluate("document.getElementById('svg-canvas').outerHTML")
        except Exception as e:
            print(f'{name}: {t["localDate"]} failed: {str(e).splitlines()[0]}')
            continue
        finally:
            page.close()
        (RAW / f'{name}.todaytix.svg').write_text(svg)
        print(f'{name}: show {show} ({detail["displayName"]}), {t["localDate"]} {t["localTime"]}, {len(svg) // 1024} kB')
        return
    raise RuntimeError(f'{name}: no chart')


if __name__ == '__main__':
    RAW.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for arg in sys.argv[1:]:
            name, show = arg.split('=')
            try:
                capture(browser, name, int(show))
            except Exception as e:
                print(f'{name}: {e}')
        browser.close()
