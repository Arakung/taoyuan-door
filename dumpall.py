"""提取指定目录下所有 classes*.dex 中的唯一字符串。用法：dumpall.py [dex目录] [输出文件]"""
import glob, sys, os
from dexstrings import strings_of

def dump_all(dex_dir='dex', out_file='allstrings.txt'):
    if not os.path.isdir(dex_dir):
        if os.path.exists('classes.dex'):
            dex_dir = '.'
        else:
            print(f"目录 {dex_dir} 不存在且当前目录未找到 classes.dex")
            return
            
    files = sorted(glob.glob(os.path.join(dex_dir, 'classes*.dex')))
    if not files:
        print(f"在 {dex_dir} 中未找到 classes*.dex 文件。")
        return

    seen = set()
    with open(out_file, 'w', encoding='utf-8') as out:
        for f in files:
            for s in strings_of(f):
                if s not in seen:
                    seen.add(s)
                    out.write(s + '\n')
    print(f'已提取 {len(seen)} 个唯一字符串到 {out_file}')

if __name__ == '__main__':
    dex_dir = sys.argv[1] if len(sys.argv) > 1 else 'dex'
    out_file = sys.argv[2] if len(sys.argv) > 2 else 'allstrings.txt'
    dump_all(dex_dir, out_file)

