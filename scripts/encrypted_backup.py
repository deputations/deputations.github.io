"""Application DB backup; only public-key encrypted bytes may leave the runner.

The recovery private key must be stored independently of GitHub and Supabase.
Auth users and Storage files are outside this public-schema backup's scope.
"""
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit


def main():
    url = os.environ.get('BACKUP_DATABASE_URL', '')
    public_key = os.environ.get('BACKUP_RECIPIENT_PUBLIC_KEY', '')
    if not url or not public_key:
        raise RuntimeError('Configure backup connection and recipient public key first')
    parts = urlsplit(url)
    if parts.scheme not in ('postgres', 'postgresql') or not parts.hostname:
        raise ValueError('Invalid PostgreSQL backup URL')
    env = dict(os.environ, PGHOST=parts.hostname, PGPORT=str(parts.port or 5432),
               PGUSER=unquote(parts.username or ''), PGPASSWORD=unquote(parts.password or ''),
               PGDATABASE=unquote(parts.path.lstrip('/')), PGSSLMODE='require')
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        keyfile = root / 'recipient.asc'
        keyfile.write_text(public_key, encoding='utf-8')
        gpg = ['gpg', '--homedir', str(root), '--batch']
        subprocess.run(gpg + ['--import', str(keyfile)], check=True, capture_output=True)
        listing = subprocess.run(gpg + ['--with-colons', '--list-keys'], check=True,
                                 capture_output=True, text=True).stdout
        primary, want_fingerprint = [], False
        for line in listing.splitlines():
            fields = line.split(':')
            if fields[0] == 'pub':
                want_fingerprint = True
            elif fields[0] == 'fpr' and want_fingerprint:
                primary.append(fields[9]); want_fingerprint = False
        if len(primary) != 1:
            raise ValueError('Provide exactly one backup recipient public key')
        dump = root / 'database.dump'
        result = subprocess.run(['pg_dump', '--format=custom', '--no-owner',
                                 '--schema=public', '--file', str(dump)], env=env, capture_output=True)
        if result.returncode:
            raise RuntimeError('Backup failed; check client/server versions and connection configuration')
        subprocess.run(['pg_restore', '--list', str(dump)], check=True, capture_output=True)
        output = Path('backup-output')
        output.mkdir(exist_ok=True)
        subprocess.run(gpg + ['--yes', '--trust-model', 'always', '--recipient', primary[0],
                              '--output', str(output / 'database.dump.gpg'), '--encrypt', str(dump)],
                       check=True, capture_output=True)
        print(f'Encrypted application backup; {dump.stat().st_size} plaintext bytes transferred')


if __name__ == '__main__':
    main()
