"""极简 DEX 解析：按类名打印字段与方法，并打印方法体引用的字符串常量。"""
import struct, sys

class Dex:
    def __init__(self, path):
        self.d = open(path, 'rb').read()
        d = self.d
        self.n_str, self.o_str = struct.unpack_from('<II', d, 0x38)
        self.n_type, self.o_type = struct.unpack_from('<II', d, 0x40)
        self.n_proto, self.o_proto = struct.unpack_from('<II', d, 0x48)
        self.n_field, self.o_field = struct.unpack_from('<II', d, 0x50)
        self.n_meth, self.o_meth = struct.unpack_from('<II', d, 0x58)
        self.n_cls, self.o_cls = struct.unpack_from('<II', d, 0x60)

    def uleb(self, i):
        r = 0; s = 0
        while True:
            x = self.d[i]; i += 1
            r |= (x & 0x7f) << s
            if not (x & 0x80):
                return r, i
            s += 7

    def string(self, idx):
        (so,) = struct.unpack_from('<I', self.d, self.o_str + 4 * idx)
        _, p = self.uleb(so)
        e = self.d.index(b'\x00', p)
        return self.d[p:e].decode('utf-8', 'replace')

    def type_str(self, idx):
        (si,) = struct.unpack_from('<I', self.d, self.o_type + 4 * idx)
        return self.string(si)

    def field(self, idx):
        c, t, n = struct.unpack_from('<HHI', self.d, self.o_field + 8 * idx)
        return self.type_str(c), self.type_str(t), self.string(n)

    def method(self, idx):
        c, p, n = struct.unpack_from('<HHI', self.d, self.o_meth + 8 * idx)
        return self.type_str(c), p, self.string(n)

    def proto(self, idx):
        (si,) = struct.unpack_from('<I', self.d, self.o_proto + 12 * idx)
        return self.string(si)

    def classes(self):
        for i in range(self.n_cls):
            off = self.o_cls + 32 * i
            cidx, flags, sup, iface, src, anno, cdata, sv = struct.unpack_from('<IIIIIIII', self.d, off)
            yield self.type_str(cidx), sup, cdata, flags

    def class_data(self, cdata):
        if cdata == 0:
            return [], [], [], []
        i = cdata
        sf, i = self.uleb(i); inf, i = self.uleb(i); dm, i = self.uleb(i); vm, i = self.uleb(i)
        def fields(n, i):
            out = []; idx = 0
            for _ in range(n):
                diff, i = self.uleb(i)
                fl, i = self.uleb(i)
                idx += diff
                out.append(self.field(idx))
            return out, i
        def meths(n, i):
            out = []; idx = 0
            for _ in range(n):
                diff, i = self.uleb(i)
                fl, i = self.uleb(i)
                co, i = self.uleb(i)
                idx += diff
                out.append((self.method(idx), co))
            return out, i
        a, i = fields(sf, i)
        b, i = fields(inf, i)
        c, i = meths(dm, i)
        e, i = meths(vm, i)
        return a, b, c, e

    def code_strings(self, code_off):
        """粗粒度：取 code_item 里所有 string index 引用到的常量。"""
        if code_off == 0:
            return []
        d = self.d
        regs, ins, outs, tries, dbg, n = struct.unpack_from('<HHHHII', d, code_off)
        p = code_off + 16
        end = p + n * 2
        out = []
        # 扫描 const-string / const-string/jumbo 指令
        i = p
        while i < end - 1:
            u = struct.unpack_from('<H', d, i)[0]
            op = u & 0xff
            if op == 0x1a:      # const-string vAA, string@BBBB
                si = struct.unpack_from('<H', d, i + 2)[0]
                if si < self.n_str:
                    out.append(self.string(si))
                i += 4
                continue
            if op == 0x1b:      # const-string/jumbo
                si = struct.unpack_from('<I', d, i + 2)[0]
                if si < self.n_str:
                    out.append(self.string(si))
                i += 6
                continue
            i += 2
        return out


def main():
    if len(sys.argv) < 3:
        print("Usage: python dexclass.py <path_to_dex> <class_filter> [code|dump]")
        sys.exit(1)
    path, want = sys.argv[1], sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else 'dump'
    dx = Dex(path)
    for name, sup, cdata, flags in dx.classes():
        if want.lower() not in name.lower():
            continue
        print(f'### {name}  extends {dx.type_str(sup) if sup != 0xffffffff else "-"}')
        sf, inf, dm, vm = dx.class_data(cdata)
        for _c, _t, _n in inf:
            print(f"   field {_n}: {_t}")
        for (mn, co) in dm + vm:
            proto = dx.proto(mn[1])
            print(f'   method {mn[2]}{proto}')
            if mode == 'code':
                ss = dx.code_strings(co)
                if ss:
                    print('      strings:', ' | '.join(dict.fromkeys(ss))[:1200])
        print()


if __name__ == '__main__':
    main()

