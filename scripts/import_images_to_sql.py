"""一次性导入脚本：将 gallery/ 目录下的 PNG 图片写入 Azure SQL 数据库。

功能：
1. 扫描 gallery/*.png，文件名（去掉 .png）即 [图片编号]。
2. 将图片字节写入 [图片数据]，MIME 写入 [图片MIME类型]（image/png）。
3. 将 [图片位置] 统一更新为 /api/images/<图片编号>。
4. 只更新已存在的记录；数据库中缺失对应记录时给出提示（可用 --insert 补建）。

运行环境：需要能访问数据库（在 Azure Web App 上运行，或本机配置好凭据）。

用法：
    python scripts/import_images_to_sql.py            # 仅更新已存在记录
    python scripts/import_images_to_sql.py --insert   # 缺失记录时按文件名补建（最小字段）
    python scripts/import_images_to_sql.py --dry-run   # 只打印将要执行的操作
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

MIME_PNG = "image/png"


def collect_images():
    images = []
    if not server.GALLERY.exists():
        return images
    for path in sorted(server.GALLERY.glob("*.png")):
        image_id = path.stem
        images.append((image_id, path))
    return images


def record_exists(cursor, image_id):
    cursor.execute(
        "SELECT 1 FROM [dbo].[Knowledge_doc] WHERE [图片编号] = ?",
        image_id,
    )
    return cursor.fetchone() is not None


def update_existing(cursor, image_id, data):
    cursor.execute(
        """
        UPDATE [dbo].[Knowledge_doc]
        SET [图片数据] = ?,
            [图片MIME类型] = ?,
            [图片位置] = ?
        WHERE [图片编号] = ?
        """,
        bytes(data), MIME_PNG, server.image_url_for(image_id), image_id,
    )
    return cursor.rowcount


def insert_missing(cursor, image_id, data):
    # 按编号推断层级与上层：形如 1.2 -> 层级2，上层1；纯数字 -> 层级1，无上层
    parts = image_id.split(".")
    level = len(parts)
    cursor.execute(
        """
        INSERT INTO [dbo].[Knowledge_doc]
            ([图像提示词], [图片位置], [图片层级], [图片编号], [上层图片],
             [知识点], [显示方式], [图片数据], [图片MIME类型])
        VALUES (N'', ?, ?, ?, N'无', N'', N'固定', ?, ?)
        """,
        server.image_url_for(image_id), level, image_id, bytes(data), MIME_PNG,
    )


def main():
    parser = argparse.ArgumentParser(description="导入 gallery 图片到 SQL 数据库")
    parser.add_argument("--insert", action="store_true", help="数据库缺失记录时补建")
    parser.add_argument("--dry-run", action="store_true", help="只打印不执行")
    args = parser.parse_args()

    images = collect_images()
    if not images:
        print("gallery 目录下没有找到 PNG 文件。")
        return

    print(f"发现 {len(images)} 张图片。")
    updated = inserted = skipped = 0

    connection = server.get_connection()
    try:
        cursor = connection.cursor()
        for image_id, path in images:
            data = path.read_bytes()
            exists = record_exists(cursor, image_id)
            if exists:
                print(f"[更新] {image_id} <- {path.name} ({len(data)} bytes)")
                if not args.dry_run:
                    update_existing(cursor, image_id, data)
                updated += 1
            elif args.insert:
                print(f"[新建] {image_id} <- {path.name} ({len(data)} bytes)")
                if not args.dry_run:
                    insert_missing(cursor, image_id, data)
                inserted += 1
            else:
                print(f"[跳过] {image_id}：数据库无此记录（加 --insert 可补建）")
                skipped += 1
        if not args.dry_run:
            connection.commit()
    finally:
        connection.close()

    print("-" * 40)
    print(f"完成：更新 {updated}，新建 {inserted}，跳过 {skipped}")
    if args.dry_run:
        print("(dry-run，未实际写入)")


if __name__ == "__main__":
    main()
