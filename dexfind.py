"""在指定 DEX 中查找包含指定方法名的方法原型。用法：dexfind.py <dex路径> <方法名片段>"""
import sys
from dexclass import Dex

def find_methods(path, pat):
    dx = Dex(path)
    for name, sup, cdata, flags in dx.classes():
        sf, inf, dm, vm = dx.class_data(cdata)
        for (mn, co) in dm + vm:
            if pat.lower() in mn[2].lower():
                print(f'{name}  ->  {mn[2]}{dx.proto(mn[1])}')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python dexfind.py <dex路径> <方法名片段>")
        sys.exit(1)
    find_methods(sys.argv[1], sys.argv[2])

