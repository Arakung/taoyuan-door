"""给定字符串/正则，找出所有引用它的类::方法。用法：strfind.py <dex路径|包含dex的目录> <regex> [--class-only]"""
import sys, re, glob, os
from dexclass import Dex

def search_str_refs(target, pattern, class_only=False):
    rx = re.compile(pattern)
    files = sorted(glob.glob(os.path.join(target, 'classes*.dex'))) if os.path.isdir(target) else [target]
    if not files:
        print(f"在 {target} 中未找到任何 classes*.dex 文件。")
        return

    for f in files:
        dx = Dex(f)
        for name, sup, cdata, flags in dx.classes():
            sf, inf, dm, vm = dx.class_data(cdata)
            for (mn, co) in dm + vm:
                if not co:
                    continue
                try:
                    ss = dx.code_strings(co)
                except Exception:
                    continue
                hit = [s for s in ss if rx.search(s)]
                if hit:
                    if class_only:
                        print(f'[{os.path.basename(f)}] {name}')
                        break
                    print(f'{name} :: {mn[2]}{dx.proto(mn[1])}')
                    for h in hit[:4]:
                        print(f'      | {h[:120]}')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python strfind.py <dex路径|包含dex的目录> <regex> [--class-only]")
        sys.exit(1)
    target = sys.argv[1]
    pattern = sys.argv[2]
    class_only = '--class-only' in sys.argv
    search_str_refs(target, pattern, class_only)

