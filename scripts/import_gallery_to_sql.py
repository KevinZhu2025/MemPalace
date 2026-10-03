"""Import tracked PNG files into the Knowledge_doc Azure SQL table."""

import argparse
from pathlib import Path
import sys

import pyodbc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ROOT, get_connection


def apply_schema_migration(cursor):
    cursor.execute(
        """
        IF COL_LENGTH(N'dbo.Knowledge_doc', N'图片数据') IS NULL
        BEGIN
            ALTER TABLE [dbo].[Knowledge_doc]
            ADD [图片数据] VARBINARY(MAX) NULL;
        END;
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH(N'dbo.Knowledge_doc', N'图片MIME类型') IS NULL
        BEGIN
            ALTER TABLE [dbo].[Knowledge_doc]
            ADD [图片MIME类型] NVARCHAR(100) NULL;
        END;
        """
    )
    cursor.execute(
        """
        DELETE FROM [dbo].[Knowledge_doc]
        WHERE [图片编号] IN (N'1.7', N'1.8');
        """
    )


def png_files(gallery):
    files = {}
    for path in gallery.glob("*.png"):
        if path.stem in files:
            raise RuntimeError(f"图片编号重复：{path.stem}")
        files[path.stem] = path
    if not files:
        raise RuntimeError(f"未在 {gallery} 找到 PNG 图片。")
    return files


def import_gallery(gallery, apply_schema=False):
    files = png_files(gallery)
    with get_connection() as connection:
        cursor = connection.cursor()
        if apply_schema:
            apply_schema_migration(cursor)
        cursor.execute(
            """
            SELECT [图片编号]
            FROM [dbo].[Knowledge_doc]
            WHERE [图片位置] <> N'' OR [图片数据] IS NOT NULL
            """
        )
        database_ids = {str(row[0]) for row in cursor.fetchall()}

        missing_files = sorted(database_ids - files.keys())
        unknown_files = sorted(files.keys() - database_ids)
        if missing_files or unknown_files:
            details = []
            if missing_files:
                details.append(f"数据库图片缺少本地 PNG：{', '.join(missing_files)}")
            if unknown_files:
                details.append(f"本地 PNG 没有对应数据库记录：{', '.join(unknown_files)}")
            raise RuntimeError("；".join(details))

        for image_id in sorted(files):
            image_bytes = files[image_id].read_bytes()
            cursor.execute(
                """
                UPDATE [dbo].[Knowledge_doc]
                SET [图片数据] = ?, [图片MIME类型] = N'image/png',
                    [图片位置] = CONCAT(N'/api/images/', [图片编号])
                WHERE [图片编号] = ?
                """,
                pyodbc.Binary(image_bytes),
                image_id,
            )
        connection.commit()
    return len(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gallery", type=Path, default=Path(ROOT) / "gallery")
    parser.add_argument(
        "--apply-schema",
        action="store_true",
        help="Apply the idempotent Knowledge_doc image schema migration before importing.",
    )
    args = parser.parse_args()
    count = import_gallery(args.gallery, apply_schema=args.apply_schema)
    print(f"已将 {count} 个 PNG 图片导入 Azure SQL。")


if __name__ == "__main__":
    main()
