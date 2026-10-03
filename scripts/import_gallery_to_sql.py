"""Import tracked PNG files into the Knowledge_doc Azure SQL table."""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_storage_migration import import_gallery
from server import ROOT, get_connection


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gallery", type=Path, default=Path(ROOT) / "gallery")
    parser.add_argument(
        "--apply-schema",
        action="store_true",
        help="Apply the idempotent Knowledge_doc image schema migration before importing.",
    )
    args = parser.parse_args()
    count = import_gallery(get_connection, args.gallery, apply_schema=args.apply_schema)
    print(f"已将 {count} 个 PNG 图片导入 Azure SQL。")


if __name__ == "__main__":
    main()
