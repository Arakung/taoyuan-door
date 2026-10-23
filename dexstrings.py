"""从 DEX 提取全部字符串（含 MUTF-8 -> UTF-8 转换）。"""
import struct, sys, io, re

def uleb128(b, i):
    r = 0; s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7f) << s
        if not (x & 0x80):
            return r, i
        s += 7

def strings_of(path):
    data = open(path, 'rb').read()
    if data[:4] != b'dex\n':
        return []
    size, off = struct.unpack_from('<II', data, 0x38)
    out = []
    for i in range(size):
        (so,) = struct.unpack_from('<I', data, off + 4 * i)
        _, p = uleb128(data, so)
        e = data.index(b'\x00', p) if b'\x00' in data[p:p+4096] else p
        raw = data[p:e]
        try:
            out.append(raw.decode('utf-8', 'replace'))
        except Exception:
            out.append(raw.decode('latin-1', 'replace'))
    return out

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python dexstrings.py <dex路径> [可选正则过滤]")
        sys.exit(1)
    pat = sys.argv[2] if len(sys.argv) > 2 else None
    ss = strings_of(sys.argv[1])
    if pat:
        rx = re.compile(pat, re.I)
        for s in ss:
            if rx.search(s):
                print(s)
    else:
        print(len(ss))

