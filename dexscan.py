"""扫描指定 DEX 中引用了指定字符串的方法。用法：dexscan.py <dex路径> <字符串片段>"""
import sys
from dexclass import Dex

def scan_strings(path, pat):
    dx = Dex(path)
    for name, sup, cdata, flags in dx.classes():
        sf, inf, dm, vm = dx.class_data(cdata)
        for (mn, co) in dm + vm:
            ss = dx.code_strings(co)
            hit = [s for s in ss if pat in s.lower()]
            if hit:
                print(f'{name}  ->  {mn[2]}{dx.proto(mn[1])}')
                print('     ', ' | '.join(dict.fromkeys(hit))[:400])

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python dexscan.py <dex路径> <字符串片段>")
        sys.exit(1)
    scan_strings(sys.argv[1], sys.argv[2].lower())

