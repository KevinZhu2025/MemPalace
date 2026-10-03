from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import shutil
import sys
import time
import urllib.request
from urllib.error import HTTPError
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "知识点文档.csv"
GALLERY_DIR = ROOT / "gallery"
LOG_PATH = ROOT / "image-generation.log"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com"
IMAGE_MODEL = "qwen-image-3.0"
TASK_ENDPOINT = "/api/v1/services/aigc/multimodal-generation/generation"
REQUIRED_FIELDS = ["图像提示词", "图片位置", "图片层级", "图片编号", "上层图片", "知识点"]
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate missing MemPalace images and update the CSV.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and list pending rows without calling the API.")
    parser.add_argument("--csv", type=Path, default=CSV_PATH, help="CSV path, defaults to the workspace knowledge CSV.")
    return parser.parse_args()


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name:
            os.environ.setdefault(name, value)


def log_event(event: dict) -> None:
    event = {"time": datetime.now(timezone.utc).isoformat(), **event}
    with LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(event, ensure_ascii=False) + "\n")


def read_rows(csv_path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        if reader.fieldnames is None:
            raise ValueError("CSV 缺少表头。")
        missing = [field for field in REQUIRED_FIELDS if field not in reader.fieldnames]
        if missing:
            raise ValueError(f"CSV 缺少字段：{'、'.join(missing)}")
        rows = list(reader)

    seen_ids: set[str] = set()
    for line_number, row in enumerate(rows, start=2):
        if row.get(None) is not None:
            raise ValueError(f"第 {line_number} 行包含多余字段，请检查逗号和引号。")
        image_id = (row.get("图片编号") or "").strip()
        if not image_id:
            raise ValueError(f"第 {line_number} 行缺少图片编号。")
        if image_id in seen_ids:
            raise ValueError(f"图片编号重复：{image_id}。")
        if not SAFE_ID.fullmatch(image_id):
            raise ValueError(f"图片编号 {image_id} 含有不安全字符，只允许字母、数字、点、下划线和连字符。")
        seen_ids.add(image_id)

    return reader.fieldnames, rows


def request_json(url: str, api_key: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"百炼 API HTTP {error.code}: {detail}") from error


def download_image(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def find_image_url(output: dict) -> str | None:
    for result in output.get("results", []):
        if result.get("url"):
            return result["url"]
    for choice in output.get("choices", []):
        content = choice.get("message", {}).get("content", [])
        for part in content:
            if part.get("image"):
                return part["image"]
            if part.get("url"):
                return part["url"]
    return None


def generate_image(api_key: str, prompt: str, base_url: str) -> bytes:
    response = request_json(
        f"{base_url.rstrip('/')}{TASK_ENDPOINT}",
        api_key,
        method="POST",
        payload={
            "model": IMAGE_MODEL,
            "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
            "parameters": {"size": "1024*1024", "n": 1, "prompt_extend": True, "watermark": False},
        },
    )
    direct_url = find_image_url(response.get("output", {}))
    if direct_url:
        return download_image(direct_url)
    task_id = response.get("output", {}).get("task_id")
    if not task_id:
        raise RuntimeError(f"百炼 API 未返回 task_id：{response}")

    task_url = f"{base_url.rstrip('/')}/api/v1/tasks/{task_id}"
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        task = request_json(task_url, api_key)
        output = task.get("output", {})
        status = output.get("task_status")
        if status == "SUCCEEDED":
            image_url = find_image_url(output)
            if image_url:
                return download_image(image_url)
            raise RuntimeError(f"任务成功但没有图片 URL：{task}")
        if status in {"FAILED", "CANCELED", "UNKNOWN"}:
            raise RuntimeError(f"图片任务{status}：{output.get('message') or task}")
        time.sleep(5)
    raise TimeoutError(f"图片任务 {task_id} 等待超过 300 秒。")


def write_csv_atomically(csv_path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    backup_path = csv_path.with_suffix(csv_path.suffix + ".bak")
    temp_path: Path | None = None
    try:
        shutil.copy2(csv_path, backup_path)
        with NamedTemporaryFile("w", encoding="utf-8-sig", newline="", dir=csv_path.parent, delete=False) as temp_file:
            temp_path = Path(temp_file.name)
            writer = csv.DictWriter(temp_file, fieldnames=fieldnames, extrasaction="raise")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_path, csv_path)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def should_generate(row: dict[str, str]) -> bool:
    image_location = (row.get("图片位置") or "").strip()
    prompt = (row.get("图像提示词") or "").strip()
    return not image_location and bool(prompt) and prompt != "无"


def main() -> int:
    load_dotenv()
    args = parse_args()
    csv_path = args.csv.resolve()
    if not csv_path.exists():
        print(f"找不到 CSV：{csv_path}", file=sys.stderr)
        return 1

    try:
        fieldnames, rows = read_rows(csv_path)
    except (OSError, ValueError) as error:
        print(f"CSV 校验失败：{error}", file=sys.stderr)
        return 1

    pending = [row for row in rows if should_generate(row)]
    print(f"共读取 {len(rows)} 条记录，待生成 {len(pending)} 张图片。")
    if args.dry_run:
        for row in pending:
            print(f"- {row['图片编号']}: {row['图像提示词']}")
        return 0
    if not pending:
        print("没有需要生成的图片。")
        return 0
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print("缺少 DASHSCOPE_API_KEY 环境变量。", file=sys.stderr)
        return 1

    GALLERY_DIR.mkdir(parents=True, exist_ok=True)
    base_url = os.environ.get("DASHSCOPE_BASE_URL", DEFAULT_BASE_URL)
    success_count = 0
    failure_count = 0
    for row in pending:
        image_id = row["图片编号"].strip()
        target = GALLERY_DIR / f"{image_id}.png"
        relative_path = target.relative_to(ROOT).as_posix()
        try:
            if target.exists() and target.stat().st_size > 0:
                row["图片位置"] = relative_path
                success_count += 1
                print(f"已复用：{relative_path}")
                continue
            prompt = row["图像提示词"].strip()
            if not prompt:
                raise ValueError("图像提示词为空")
            image_bytes = generate_image(api_key, prompt, base_url)
            if not image_bytes:
                raise ValueError("生成结果为空")
            temp_image = target.with_suffix(".tmp")
            temp_image.write_bytes(image_bytes)
            os.replace(temp_image, target)
            row["图片位置"] = relative_path
            success_count += 1
            print(f"已生成：{relative_path}")
            log_event({"status": "success", "id": image_id, "path": relative_path})
        except Exception as error:
            failure_count += 1
            print(f"生成失败 {image_id}：{error}", file=sys.stderr)
            log_event({"status": "failed", "id": image_id, "error": str(error)})

    if success_count:
        write_csv_atomically(csv_path, fieldnames, rows)
        print(f"已回写 CSV：成功 {success_count}，失败 {failure_count}。")
    else:
        print(f"没有成功生成的图片，CSV 未修改。失败 {failure_count}。")
    return 0 if failure_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
