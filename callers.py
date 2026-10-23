"""查找调用了指定方法的所有类与方法。用法：callers.py <dex路径> <目标方法名片段>"""
import struct, sys
from dexclass import Dex
from dexdis import FMT, LEN, NAMES

def find_callers(path, target):
    dx = Dex(path)
    for name, sup, cdata, flags in dx.classes():
        sf, inf, dm, vm = dx.class_data(cdata)
        for (mn, co) in dm + vm:
            if not co:
                continue
            d = dx.d
            regs, ins, outs, tries, dbg, n = struct.unpack_from('<HHHHII', d, co)
            p = co + 16
            end = p + n * 2
            hits = []
            while p < end:
                u = struct.unpack_from('<H', d, p)[0]
                op = u & 0xff
                fmt = FMT.get(op)
                if fmt is None:
                    p += 2
                    continue
                if 0x6e <= op <= 0x72 or 0x74 <= op <= 0x78:
                    mi = struct.unpack_from('<H', d, p + 2)[0]
                    try:
                        c, pr, nm = dx.method(mi)
                        if target.lower() in nm.lower():
                            hits.append(f'{c}->{nm}')
                    except Exception:
                        pass
                p += LEN[fmt] * 2
            if hits:
                print(f'{name} :: {mn[2]}{dx.proto(mn[1])}  ==>  {", ".join(hits)}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python callers.py <dex路径> <目标方法名片段>")
        sys.exit(1)
    find_callers(sys.argv[1], sys.argv[2])

