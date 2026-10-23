"""定位类所在 dex 并打印结构。用法：cls.py <类名片段> [--deep] [dex目录或文件]"""
import sys, glob, os
from dexclass import Dex

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python cls.py <类名片段> [--deep] [dex目录或文件路径]")
        sys.exit(1)

    pat = sys.argv[1].lower()
    deep = '--deep' in sys.argv
    
    # 解析目标目录或路径，默认为当前目录或 ./dex
    target = None
    for arg in sys.argv[2:]:
        if not arg.startswith('--'):
            target = arg
            break
            
    if target:
        if os.path.isdir(target):
            files = sorted(glob.glob(os.path.join(target, 'classes*.dex')))
        else:
            files = [target]
    else:
        files = sorted(glob.glob(os.path.join('dex', 'classes*.dex')))
        if not files:
            files = sorted(glob.glob('classes*.dex'))

    if not files:
        print("未找到 classes*.dex 文件，请指定包含 DEX 的目录或文件路径。")
        sys.exit(1)

    for f in files:
        dx = Dex(f)
        for name, sup, cdata, flags in dx.classes():
            if pat not in name.lower():
                continue
            print(f'[{os.path.basename(f)}] {name}')
            if deep:
                sf, inf, dm, vm = dx.class_data(cdata)
                for _c, _t, n in inf:
                    print(f'    field {n}: {_t}')
                for (mn, co) in dm + vm:
                    print(f'    method {mn[2]}{dx.proto(mn[1])}')

