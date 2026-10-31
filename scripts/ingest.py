"""Build static Western Pacific storm files from NOAA IBTrACS; no database."""
import csv
import io
import json
import math
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SOURCE = 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.WP.list.v04r01.csv'
ROOT = Path(__file__).resolve().parents[1] / 'public' / 'data'

def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) and n > -900 else None
    except (ValueError, TypeError):
        return None

def convert(rows):
    storms = defaultdict(list)
    names = {}
    provisional = set()
    for raw in rows:
        row = {k.strip(): (v or '').strip() for k, v in raw.items() if k}
        if not row.get('SEASON', '').isdigit() or int(row['SEASON']) < 1951:
            continue
        # Exclude alternate spurs, which can duplicate a storm's main track.
        if row.get('TRACK_TYPE', '').lower().endswith('spur'):
            continue
        lat, lon = number(row.get('LAT')), number(row.get('LON'))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        sid = row['SID']
        time = datetime.fromisoformat(row['ISO_TIME']).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z')
        # Use WMO columns, retaining agency and averaging period; never blend agencies.
        agency = row.get('WMO_AGENCY') or 'Not reported'
        averaging = {'tokyo': 10, 'usa': 1, 'jtwc': 1, 'newdelhi': 3, 'hko': 10, 'cma': 2, 'reunion': 10, 'bom': 10}.get(agency.lower())
        storms[sid].append({'time': time, 'lat': lat, 'lon': lon, 'wind': number(row.get('WMO_WIND')), 'pressure': number(row.get('WMO_PRES')), 'agency': agency, 'averagingMinutes': averaging})
        if row.get('NAME') and row['NAME'] != 'NOT_NAMED':
            names[sid] = row['NAME'].title()
        if row.get('TRACK_TYPE') in ('PROVISIONAL', 'PROVISIONAL_spur'):
            provisional.add(sid)
    result = []
    for sid, track in storms.items():
        track = sorted({p['time']: p for p in track}.values(), key=lambda p: p['time'])
        if len(track) < 2:
            continue
        winds = [p['wind'] for p in track if p['wind'] is not None]
        result.append({'id': sid, 'name': names.get(sid, 'Unnamed'), 'year': int(track[0]['time'][:4]), 'start': track[0]['time'], 'end': track[-1]['time'], 'peakWind': max(winds) if winds else None, 'points': len(track), 'source': 'NOAA IBTrACS v04r01 · WMO agency values', 'sourceUrl': 'https://www.ncei.noaa.gov/products/international-best-track-archive', 'provisional': sid in provisional, 'track': track})
    return sorted(result, key=lambda s: s['start'], reverse=True)

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    tmp.replace(path)

def main():
    request = urllib.request.Request(SOURCE, headers={'User-Agent': 'Bakas/0.1 (IBTrACS archive ingestion)'})
    print('Downloading NOAA Western Pacific archive...', flush=True)
    with urllib.request.urlopen(request, timeout=180) as response:
        storms = convert(csv.DictReader(io.TextIOWrapper(response, encoding='utf-8-sig')))
    if len(storms) < 1000:
        raise RuntimeError('Incomplete archive; refusing to replace the existing index.')
    for storm in storms:
        write_json(ROOT / 'storms' / (storm['id'] + '.json'), storm)
    summaries = [{k: v for k, v in storm.items() if k not in ('track', 'source', 'sourceUrl', 'provisional')} for storm in storms]
    write_json(ROOT / 'index.json', {'generated': datetime.now(timezone.utc).isoformat(), 'source': SOURCE, 'version': 'IBTrACS v04r01', 'storms': summaries})
    expected = {storm['id'] for storm in storms}
    for path in (ROOT / 'storms').glob('*.json'):
        if path.stem not in expected:
            path.unlink()
    print(f'Wrote {len(storms)} storms and {sum(s["points"] for s in storms)} positions.', flush=True)

if __name__ == '__main__':
    main()
