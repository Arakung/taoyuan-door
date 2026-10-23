"""按方法打印 Dalvik 指令（足够读懂字符串拼接与调用顺序）。"""
import struct, sys

FMT = {}
def setf(codes, fmt):
    for c in codes:
        FMT[c] = fmt

setf(range(0x00, 0x01), '10x')
setf([0x01,0x04,0x07], '12x')
setf([0x02,0x05,0x08], '22x')
setf([0x03,0x06,0x09], '32x')
setf(range(0x0a, 0x0e), '11x')
setf([0x0e], '10x')
setf([0x0f,0x10,0x11,0x1d,0x1e,0x27], '11x')
setf([0x12], '11n')
setf([0x13,0x16], '21s')
setf([0x14,0x17], '31i')
setf([0x15,0x19], '21h')
setf([0x18], '51l')
setf([0x1a,0x1c,0x1f,0x22,0xfe,0xff], '21c')
setf([0x1b], '31c')
setf([0x20,0x23], '22c')
setf(range(0x21, 0x22), '12x')
setf([0x24,0xfc], '35c')
setf([0x25,0xfd], '3rc')
setf([0x26,0x2b,0x2c], '31t')
setf([0x28], '10t')
setf([0x29], '20t')
setf([0x2a], '30t')
setf(range(0x2d, 0x32), '23x')
setf(range(0x32, 0x38), '22t')
setf(range(0x38, 0x3e), '21t')
setf(range(0x44, 0x52), '23x')
setf(range(0x52, 0x60), '22c')
setf(range(0x60, 0x6e), '21c')
setf(range(0x6e, 0x73), '35c')
setf(range(0x74, 0x79), '3rc')
setf(range(0x7b, 0x90), '12x')
setf(range(0x90, 0xb0), '23x')
setf(range(0xb0, 0xd0), '12x')
setf(range(0xd0, 0xd8), '22s')
setf(range(0xd8, 0xe3), '22b')
setf([0xfa], '45cc')
setf([0xfb], '4rcc')

LEN = {'10x':1,'12x':1,'11n':1,'11x':1,'10t':1,'20t':2,'22x':2,'21t':2,'21s':2,'21h':2,
       '21c':2,'23x':2,'22b':2,'22t':2,'22s':2,'22c':2,'32x':3,'30t':3,'31t':3,'31i':3,
       '31c':3,'35c':3,'3rc':3,'45cc':4,'4rcc':4,'51l':5}

NAMES = {0x00:'nop',0x01:'move',0x07:'move-object',0x0a:'move-result',0x0c:'move-result-object',
 0x0d:'move-exception',0x0e:'return-void',0x0f:'return',0x11:'return-object',0x12:'const/4',
 0x13:'const/16',0x14:'const',0x15:'const/high16',0x1a:'const-string',0x1b:'const-string/jumbo',
 0x1c:'const-class',0x1f:'check-cast',0x22:'new-instance',0x24:'filled-new-array',
 0x28:'goto',0x29:'goto/16',0x2a:'goto/32',0x32:'if-eq',0x33:'if-ne',0x34:'if-lt',
 0x35:'if-ge',0x36:'if-gt',0x37:'if-le',0x38:'if-eqz',0x39:'if-nez',0x3a:'if-ltz',
 0x3b:'if-gez',0x3c:'if-gtz',0x3d:'if-lez',0x27:'throw',0x6e:'invoke-virtual',
 0x6f:'invoke-super',0x70:'invoke-direct',0x71:'invoke-static',0x72:'invoke-interface',
 0x74:'invoke-virtual/range',0x77:'invoke-static/range',0x0b:'move-result-wide'}

from dexclass import Dex



def dump(path, cls_pat, meth_pat):
    dx = Dex(path)
    for name, sup, cdata, flags in dx.classes():
        if cls_pat.lower() not in name.lower():
            continue
        sf, inf, dm, vm = dx.class_data(cdata)
        for (mn, co) in dm + vm:
            if meth_pat.lower() not in mn[2].lower():
                continue
            print(f'=== {name} :: {mn[2]}{dx.proto(mn[1])}  code_off={co}')
            if not co:
                continue
            d = dx.d
            regs, ins, outs, tries, dbg, n = struct.unpack_from('<HHHHII', d, co)
            p = co + 16
            end = p + n * 2
            while p < end:
                u = struct.unpack_from('<H', d, p)[0]
                op = u & 0xff
                fmt = FMT.get(op)
                if fmt is None:
                    print(f'  {p-co:5d}  <unk 0x{op:02x}>')
                    p += 2
                    continue
                ln = LEN[fmt] * 2
                extra = ''
                if op in (0x1a,):
                    si = struct.unpack_from('<H', d, p + 2)[0]
                    extra = repr(dx.string(si))
                elif op == 0x1b:
                    si = struct.unpack_from('<I', d, p + 2)[0]
                    extra = repr(dx.string(si))
                elif 0x6e <= op <= 0x72 or 0x74 <= op <= 0x78:
                    mi = struct.unpack_from('<H', d, p + 2)[0]
                    try:
                        c, pr, nm = dx.method(mi)
                        extra = f'{c}->{nm}{dx.proto(pr)}'
                    except Exception:
                        extra = f'method@{mi}'
                elif 0x38 <= op <= 0x3d:
                    off = struct.unpack_from('<h', d, p + 2)[0]
                    extra = f'-> {(p+off*2)-co}'
                print(f'  {p-co:5d}  {NAMES.get(op, hex(op)):22s} {extra}')
                p += ln


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python dexdis.py <path_to_dex> <class_filter> <method_filter>")
        sys.exit(1)
    dump(sys.argv[1], sys.argv[2], sys.argv[3])

