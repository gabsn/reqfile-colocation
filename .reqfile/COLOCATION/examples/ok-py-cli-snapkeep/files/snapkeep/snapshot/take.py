import os

from .manifest import build_manifest


def take(root):
    files = {}
    for dirpath, _dirs, names in os.walk(root):
        for name in sorted(names):
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as fh:
                files[os.path.relpath(path, root)] = fh.read()
    return {"manifest": build_manifest(files), "files": files}
