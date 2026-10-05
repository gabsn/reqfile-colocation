import os


def restore(snapshot, target):
    for rel, content in snapshot["files"].items():
        path = os.path.join(target, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
