import hashlib


def build_manifest(files):
    digest = hashlib.sha256()
    for rel in sorted(files):
        digest.update(rel.encode())
        digest.update(files[rel].encode())
    return {"count": len(files), "sha256": digest.hexdigest()}
