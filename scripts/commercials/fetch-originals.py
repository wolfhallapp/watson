# Pulls full-size originals of the photo picks (~/.oracle-private/photos/picks.json) out of Horace's Google Photos
# Takeout zips on his Drive, reading only those files (rclone byte ranges), never whole zips. Saves them to
# watson data/family-photos/picks/. Private: his own files, his own PC.
#   python3 scripts/commercials/fetch-originals.py
import io, json, os, subprocess, zipfile

P = os.path.expanduser('~/.oracle-private/photos')
DEST = '/mnt/c/Users/Owner/Documents/watson/data/family-photos/picks'


class RcloneRange(io.RawIOBase):
    """A read-only, seekable file over one Drive file, using rclone cat --offset/--count."""
    def __init__(self, remote, size):
        self.remote, self.size, self.pos = remote, size, 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0: return b''
        b = subprocess.run(['rclone', 'cat', '--offset', str(self.pos), '--count', str(n), self.remote], capture_output=True, check=True).stdout
        self.pos += len(b)
        return b
    def readinto(self, buf):
        b = self.read(len(buf)); buf[:len(b)] = b; return len(b)


def main():
    picks = json.load(open(os.path.join(P, 'picks.json')))
    rows = {}
    for line in open(os.path.join(P, 'index.jsonl')):
        r = json.loads(line)
        if r['id'] in picks: rows[r['id']] = r
    want = {r['file']: r for r in rows.values()}
    print(f'{len(want)} picks to find')
    os.makedirs(DEST, exist_ok=True)
    zips = json.loads(subprocess.run(['rclone', 'lsjson', 'gdrive:Takeout', '--files-only', '--include', 'takeout-*.zip'], capture_output=True, check=True, text=True).stdout)
    got = {}
    for z in sorted(zips, key=lambda z: z['Name']):
        if len(got) == len(want): break
        try:
            zf = zipfile.ZipFile(io.BufferedReader(RcloneRange('gdrive:Takeout/' + z['Path'], z['Size']), buffer_size=1 << 20))
        except Exception as e:
            print('skip', z['Name'], e); continue
        for info in zf.infolist():
            base = os.path.basename(info.filename)
            if base in want and base not in got and not info.filename.endswith('.json'):
                r = want[base]
                person = (r.get('people') or ['photo'])[0].split()[0].lower()
                out = os.path.join(DEST, f"{person}-{base}")
                with zf.open(info) as src, open(out, 'wb') as dst: dst.write(src.read())
                got[base] = out
                print('got', out, info.file_size)
    missing = [f for f in want if f not in got]
    print(json.dumps({'got': len(got), 'missing': missing}))


if __name__ == '__main__':
    main()
