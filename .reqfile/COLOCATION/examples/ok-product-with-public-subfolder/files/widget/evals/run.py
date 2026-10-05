"""Runs the widget crate's tests before scoring it on the corpus."""
import subprocess
from pathlib import Path

WIDGET = Path(__file__).resolve().parents[1]
CRATE = WIDGET / "oss/Cargo.toml"


def main() -> None:
    subprocess.run(["cargo", "test", "--manifest-path", str(CRATE)], check=True)


if __name__ == "__main__":
    main()
