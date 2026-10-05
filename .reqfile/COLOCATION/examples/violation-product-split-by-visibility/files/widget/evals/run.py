"""Private evaluation of the public widget crate on the internal corpus."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CRATE = ROOT / "oss/widget/Cargo.toml"


def main() -> None:
    subprocess.run(["cargo", "test", "--manifest-path", str(CRATE)], check=True)


if __name__ == "__main__":
    main()
