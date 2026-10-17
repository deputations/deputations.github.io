"""Verify the public artifacts actually served by a deployment."""
import argparse
import hashlib
import json
import re
import time
import urllib.request
from pathlib import Path


def verify(base, expected):
    def get(path):
        req = urllib.request.Request(base.rstrip('/') + '/' + path, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.read()
    manifest = json.loads(get('data/vacancies-manifest.json'))
    if any(manifest[k] != expected[k] for k in ('version', 'generated_at_utc')):
        raise ValueError('Deployed manifest is not the expected publication yet')
    count, ids = 0, set()
    for descriptor in [manifest['current'], *manifest['archive'].values()]:
        if not re.fullmatch(r'snapshots/[a-f0-9]{20}/(current|archive-[a-f0-9])\.json', descriptor['path']):
            raise ValueError('Invalid manifest path')
        body = get('data/' + descriptor['path'])
        if hashlib.sha256(body).hexdigest() != descriptor['sha256']:
            raise ValueError('Deployed checksum mismatch')
        records = json.loads(body)
        if len(records) != descriptor['count']:
            raise ValueError('Deployed count mismatch')
        for row in records:
            if row['Vacancy_ID'] in ids:
                raise ValueError('Duplicate deployed identifier')
            ids.add(row['Vacancy_ID'])
        count += len(records)
    if count != manifest['record_count']:
        raise ValueError('Incomplete deployed publication')
    print(f"Verified {count} deployed records, version {manifest['version']}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='https://alldeputations.com')
    parser.add_argument('--attempts', type=int, default=1)
    args = parser.parse_args()
    expected = json.loads(Path('data/vacancies-manifest.json').read_text(encoding='utf-8'))
    for attempt in range(args.attempts):
        try:
            verify(args.base, expected)
            break
        except Exception as error:
            if attempt == args.attempts - 1:
                raise
            print(f'Publication not ready: {type(error).__name__}; retrying')
            time.sleep(20)
