import base64
import json
import os
import re
import threading
import time
import uuid
from email.parser import BytesParser
from email.policy import default
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.error import HTTPError
from urllib.error import URLError
import urllib.request


ROOT = os.path.dirname(os.path.abspath(__file__))
GALLERY = Path(ROOT) / "gallery"
FIELDS = ("图像提示词", "图片位置", "图片层级", "图片编号", "上层图片", "知识点", "显示方式")
IMAGE_ENDPOINT = "/images/generations"
TEXT_ENDPOINT = "/chat/completions"
DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
DEFAULT_ARK_REQUEST_TIMEOUT_SECONDS = 180
DEFAULT_ARK_TEXT_REQUEST_TIMEOUT_SECONDS = 300
DEFAULT_ARK_IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 60
GENERATION_JOB_TTL_SECONDS = 60 * 60
SQL_CONNECTION_ATTEMPTS = 3
TRANSIENT_SQL_STATES = {"08001", "08S01", "HYT00"}
KEY_VAULT_SECRET_NAMES = {
    "ARK_API_KEY": "ark-api-key",
    "AZURE_SQL_PASSWORD": "azure-sql-password",
}
_key_vault_secrets = {}
_generation_jobs = {}
_generation_jobs_lock = threading.Lock()


def load_dotenv():
    env_path = os.path.join(ROOT, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as env_file:
        for line in env_file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            if not os.environ.get(name):
                os.environ[name] = value.strip().strip('"').strip("'")


def get_secret(name):
    value = os.getenv(name)
    if value:
        return value
    if name in _key_vault_secrets:
        return _key_vault_secrets[name]

    vault_url = os.getenv("AZURE_KEY_VAULT_URL")
    secret_name = KEY_VAULT_SECRET_NAMES.get(name)
    if not vault_url or not secret_name:
        return ""
    try:
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.secrets import SecretClient
    except ImportError as error:
        raise RuntimeError(
            "配置了 AZURE_KEY_VAULT_URL，但缺少 azure-identity 和 azure-keyvault-secrets 依赖。"
        ) from error

    try:
        client = SecretClient(vault_url=vault_url.rstrip("/"), credential=DefaultAzureCredential())
        value = client.get_secret(secret_name).value or ""
    except Exception as error:
        raise RuntimeError(f"无法从 Azure Key Vault 读取密钥 {secret_name}：{error}") from error
    _key_vault_secrets[name] = value
    return value


def get_connection():
    try:
        import pyodbc
    except ImportError as error:
        raise RuntimeError("缺少 pyodbc，请先安装 requirements.txt 中的依赖。") from error

    connection_string = os.getenv("AZURE_SQL_CONNECTION_STRING")
    if connection_string:
        return connect_to_sql(pyodbc, connection_string)

    server = os.getenv("AZURE_SQL_SERVER")
    user = os.getenv("AZURE_SQL_USER")
    password = get_secret("AZURE_SQL_PASSWORD")
    if not server or not user or not password:
        raise RuntimeError("请配置 AZURE_SQL_SERVER、AZURE_SQL_USER 和 AZURE_SQL_PASSWORD。")

    driver = os.getenv("AZURE_SQL_DRIVER", "ODBC Driver 18 for SQL Server")
    database = os.getenv("AZURE_SQL_DATABASE", "MEMPALACE")
    authentication = os.getenv("AZURE_SQL_AUTHENTICATION", "").strip()
    authentication_part = f"Authentication={authentication};" if authentication else ""
    connection_string = (
        f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};"
        f"UID={user};PWD={password};{authentication_part}"
        "Encrypt=yes;TrustServerCertificate=no;"
        "Connection Timeout=10;"
    )
    return connect_to_sql(pyodbc, connection_string)


def connect_to_sql(pyodbc, connection_string):
    for attempt in range(SQL_CONNECTION_ATTEMPTS):
        try:
            return pyodbc.connect(connection_string, timeout=10)
        except pyodbc.Error as error:
            sql_state = str(error.args[0]) if error.args else ""
            if sql_state not in TRANSIENT_SQL_STATES or attempt == SQL_CONNECTION_ATTEMPTS - 1:
                raise
            time.sleep(attempt + 1)


def read_knowledge_records():
    query = """
        SELECT [图像提示词], [图片位置], [图片层级], [图片编号],
               [上层图片], [知识点], [显示方式]
        FROM [dbo].[Knowledge_doc]
        ORDER BY [图片层级], [图片编号]
    """
    with get_connection() as connection:
        cursor = connection.cursor()
        cursor.execute(query)
        return [
            {field: (value if value is not None else "") for field, value in zip(FIELDS, row)}
            for row in cursor.fetchall()
        ]


def read_image_record(image_id):
    """根据图片编号返回数据库中的图片二进制与 MIME 类型。"""
    query = """
        SELECT [图片数据], [图片MIME类型]
        FROM [dbo].[Knowledge_doc]
        WHERE [图片编号] = ?
    """
    with get_connection() as connection:
        cursor = connection.cursor()
        cursor.execute(query, str(image_id))
        return cursor.fetchone()


def image_url_for(image_id):
    """前端使用的图片地址：统一走数据库图片端点。"""
    return f"/api/images/{image_id}"


def normalize_image_location(value, image_id):
    """图片位置列：无论历史值是否为文件路径，统一转为数据库图片端点。"""
    return image_url_for(image_id)



def request_json(url, api_key, method="GET", payload=None, timeout_environment_name=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=get_ark_request_timeout(timeout_environment_name),
        ) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        detail = detail.strip() or "接口未返回错误详情。"
        if error.code == 401:
            detail += " 请检查 ARK_API_KEY 是否有效，并确认它属于当前方舟地域和项目。"
        raise RuntimeError(f"火山方舟 API HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"无法连接火山方舟 API，请检查 ARK_API_BASE_URL 和网络：{error.reason}") from error


def get_ark_request_timeout(environment_name=None):
    configured_timeout = os.getenv(environment_name or "", "").strip()
    if not configured_timeout:
        configured_timeout = os.getenv("ARK_REQUEST_TIMEOUT_SECONDS", "").strip()
    if not configured_timeout:
        if environment_name == "ARK_TEXT_REQUEST_TIMEOUT_SECONDS":
            return DEFAULT_ARK_TEXT_REQUEST_TIMEOUT_SECONDS
        if environment_name == "ARK_IMAGE_DOWNLOAD_TIMEOUT_SECONDS":
            return DEFAULT_ARK_IMAGE_DOWNLOAD_TIMEOUT_SECONDS
        return DEFAULT_ARK_REQUEST_TIMEOUT_SECONDS
    try:
        timeout = int(configured_timeout)
    except ValueError as error:
        raise RuntimeError("ARK_REQUEST_TIMEOUT_SECONDS 必须是正整数。") from error
    if timeout <= 0:
        raise RuntimeError("ARK_REQUEST_TIMEOUT_SECONDS 必须是正整数。")
    return timeout


def download_bytes(url):
    with urllib.request.urlopen(
        url,
        timeout=get_ark_request_timeout("ARK_IMAGE_DOWNLOAD_TIMEOUT_SECONDS"),
    ) as response:
        return response.read()


def get_ark_api_key():
    api_key = get_secret("ARK_API_KEY")
    if not api_key:
        raise RuntimeError("未配置 ARK_API_KEY，请填写火山方舟 API Key。")
    return api_key


def get_ark_model(environment_name):
    model = os.getenv(environment_name)
    if not model:
        raise RuntimeError(f"未配置 {environment_name}，请填写火山方舟模型或接入点 ID。")
    return model


def get_ark_base_url():
    return (
        os.getenv("ARK_API_BASE_URL")
        or os.getenv("API_BASE_URL")
        or DEFAULT_ARK_BASE_URL
    ).rstrip("/")


def generate_prompt(knowledge):
    api_key = get_ark_api_key()
    instruction = (
        "I want you to leaverage Memory palace skill to learn english. "
        "The idea is to use values in 'code' and 'decode' values as memory anchors "
        "to remember one sentences. Even more, I wish to create images which are "
        "high related to the sentences. I need you to generate and return prompts "
        "for creating images. Here is the code,decode and English sentences\n"
        f"{knowledge}"
    )
    try:
        response = request_json(
            f"{get_ark_base_url()}{TEXT_ENDPOINT}",
            api_key,
            method="POST",
            payload={
                "model": get_ark_model("ARK_TEXT_MODEL"),
                "messages": [{"role": "user", "content": instruction}],
            },
            timeout_environment_name="ARK_TEXT_REQUEST_TIMEOUT_SECONDS",
        )
    except (RuntimeError, TimeoutError) as error:
        raise RuntimeError(f"文本模型请求失败：{error}") from error
    content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not content.strip():
        raise RuntimeError("文本模型没有返回图像提示词。")
    return content.strip()


def generate_image(prompt):
    api_key = get_ark_api_key()
    try:
        response = request_json(
            f"{get_ark_base_url()}{IMAGE_ENDPOINT}",
            api_key,
            method="POST",
            payload={
                "model": get_ark_model("ARK_IMAGE_MODEL"),
                "prompt": prompt,
                "response_format": "url",
            },
            timeout_environment_name="ARK_IMAGE_REQUEST_TIMEOUT_SECONDS",
        )
    except (RuntimeError, TimeoutError) as error:
        raise RuntimeError(f"图片模型请求失败：{error}") from error
    images = response.get("data") or []
    if not images:
        raise RuntimeError("火山方舟图片接口没有返回图片数据。")
    image = images[0]
    if image.get("url"):
        try:
            return download_bytes(image["url"])
        except (RuntimeError, TimeoutError) as error:
            raise RuntimeError(f"生成图片下载失败：{error}") from error
    if image.get("b64_json"):
        return base64.b64decode(image["b64_json"], validate=True)
    raise RuntimeError("火山方舟图片接口没有返回图片 URL 或 Base64 数据。")


def parse_knowledge_input(text):
    fields = {}
    for line in text.splitlines():
        match = re.match(r"^\s*(Subject|Knowledges?|Code|Decode|English sentences)\s*:\s*(.*?)\s*$", line, re.I)
        if match:
            fields[match.group(1).lower()] = match.group(2).strip()
    subject = fields.get("subject", "")
    subject_key = {"english": "English", "tools": "Tools", "科学工具": "Tools", "英语": "English"}.get(subject.lower())
    if not subject_key:
        raise ValueError("Subject 必须是 English 或 Tools。")
    return fields, subject_key


def validate_generated_knowledge_input(text):
    fields, _ = parse_knowledge_input(text)
    required = ("code", "decode", "english sentences")
    missing = [field for field in required if not fields.get(field)]
    if missing:
        raise ValueError(f"未找到必填字段：{', '.join(missing)}。")


def remove_expired_generation_jobs(now):
    expired_job_ids = [
        job_id
        for job_id, job in _generation_jobs.items()
        if job["status"] != "pending" and now - job["updated_at"] > GENERATION_JOB_TTL_SECONDS
    ]
    for job_id in expired_job_ids:
        del _generation_jobs[job_id]


def run_generation_job(job_id, knowledge):
    try:
        result = create_knowledge_record(knowledge)
        update = {"status": "completed", "result": result}
    except (ValueError, RuntimeError, TimeoutError) as error:
        update = {"status": "failed", "error": str(error)}
    except Exception as error:
        update = {"status": "failed", "error": f"保存知识点失败：{error}"}

    with _generation_jobs_lock:
        job = _generation_jobs.get(job_id)
        if job is not None:
            job.update(update)
            job["updated_at"] = time.monotonic()


def start_generation_job(knowledge):
    job_id = uuid.uuid4().hex
    now = time.monotonic()
    with _generation_jobs_lock:
        remove_expired_generation_jobs(now)
        _generation_jobs[job_id] = {"status": "pending", "updated_at": now}
    thread = threading.Thread(target=run_generation_job, args=(job_id, knowledge), daemon=True)
    thread.start()
    return job_id


def get_generation_job(job_id):
    with _generation_jobs_lock:
        job = _generation_jobs.get(job_id)
        if job is None:
            return None
        return {key: value for key, value in job.items() if key != "updated_at"}


def next_image_id(cursor, parent_id):
    cursor.execute(
        "SELECT [图片编号] FROM [dbo].[Knowledge_doc] WITH (UPDLOCK, HOLDLOCK) WHERE [上层图片] = ?",
        parent_id,
    )
    suffixes = []
    prefix = f"{parent_id}."
    for (value,) in cursor.fetchall():
        value = str(value or "")
        if value.startswith(prefix) and value[len(prefix):].isdigit():
            suffixes.append(int(value[len(prefix):]))
    return f"{parent_id}.{max(suffixes, default=0) + 1}"


def normalize_png(image_bytes):
    try:
        from PIL import Image
        from io import BytesIO
    except ImportError as error:
        raise RuntimeError("保存图片需要 Pillow，请先安装 requirements.txt 中的依赖。") from error
    with Image.open(BytesIO(image_bytes)) as image:
        buffer = BytesIO()
        image.convert("RGBA").save(buffer, format="PNG")
    return buffer.getvalue(), "image/png"


def import_gallery_to_database():
    """将 gallery/*.png 一次性导入数据库。供管理端点调用。"""
    if not GALLERY.exists():
        return {"updated": 0, "inserted": 0, "skipped": 0, "detail": "gallery 目录不存在。"}
    updated = inserted = skipped = 0
    detail = []
    with get_connection() as connection:
        cursor = connection.cursor()
        for path in sorted(GALLERY.glob("*.png")):
            image_id = path.stem
            data, mime_type = normalize_png(path.read_bytes())
            cursor.execute(
                "SELECT 1 FROM [dbo].[Knowledge_doc] WHERE [图片编号] = ?",
                image_id,
            )
            if cursor.fetchone() is None:
                skipped += 1
                detail.append(f"{image_id}: 数据库无记录，已跳过")
                continue
            cursor.execute(
                """
                UPDATE [dbo].[Knowledge_doc]
                SET [图片数据] = ?, [图片MIME类型] = ?, [图片位置] = ?
                WHERE [图片编号] = ?
                """,
                bytes(data), mime_type, image_url_for(image_id), image_id,
            )
            if cursor.rowcount:
                updated += 1
            else:
                inserted += 1
        connection.commit()
    return {"updated": updated, "inserted": inserted, "skipped": skipped, "detail": detail}


def create_knowledge_record(text, image_bytes=None):
    fields, subject = parse_knowledge_input(text)
    parent_id = "1" if subject == "English" else "2"
    if image_bytes is not None and not (fields.get("knowledges") or fields.get("knowledge")):
        raise ValueError("上传图片时必须提供 Knowledges 字段。")
    if image_bytes is None:
        validate_generated_knowledge_input(text)
        prompt = generate_prompt(text)
        generated_image = generate_image(prompt)
    else:
        prompt = ""
        generated_image = image_bytes

    png_bytes, mime_type = normalize_png(generated_image)

    with get_connection() as connection:
        cursor = connection.cursor()
        image_id = next_image_id(cursor, parent_id)
        image_path = image_url_for(image_id)
        cursor.execute(
            """
            INSERT INTO [dbo].[Knowledge_doc]
                ([图像提示词], [图片位置], [图片层级], [图片编号], [上层图片],
                 [知识点], [显示方式], [图片数据], [图片MIME类型])
            VALUES (?, ?, 2, ?, ?, ?, N'悬浮', ?, ?)
            """,
            prompt, image_path, image_id, parent_id, text.strip(),
            bytes(png_bytes), mime_type,
        )
        connection.commit()
    return {"id": image_id, "prompt": prompt, "imageUrl": image_path}


def read_form(handler):
    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
        raise ValueError("请求体为空或超过 10 MB 限制。")
    content_type = handler.headers.get("Content-Type", "")
    body = handler.rfile.read(content_length)
    message = BytesParser(policy=default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + body
    )
    fields = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name == "knowledge":
            fields[name] = part.get_payload(decode=True).decode("utf-8")
        elif name == "image" and part.get_filename():
            fields[name] = part.get_payload(decode=True)
    return fields


class MemPalaceHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/healthz":
            self.send_json(200, {"status": "ok"})
            return
        if path.startswith("/api/generations/"):
            job_id = path.removeprefix("/api/generations/")
            if not re.fullmatch(r"[0-9a-f]{32}", job_id):
                self.send_json(404, {"error": "生成任务不存在。"})
                return
            job = get_generation_job(job_id)
            if job is None:
                self.send_json(404, {"error": "生成任务不存在或已过期。"})
            else:
                self.send_json(200, job)
            return
        if path == "/api/knowledge":
            try:
                self.send_json(200, read_knowledge_records())
            except Exception as error:
                self.send_json(503, {"error": str(error)})
            return
        if path.startswith("/api/images/"):
            image_id = path.removeprefix("/api/images/")
            if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", image_id):
                self.send_json(404, {"error": "图片不存在。"})
                return
            try:
                record = read_image_record(image_id)
            except Exception as error:
                self.send_json(503, {"error": f"读取图片失败：{error}"})
                return
            if record is None or record[0] is None:
                self.send_json(404, {"error": "图片尚未生成。"})
                return
            image_data, mime_type = record
            self.send_image(200, bytes(image_data), mime_type or "image/png")
            return
        super().do_GET()

    def send_image(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/admin/import-gallery":
            self.handle_admin_import()
            return
        if path != "/api/generate":
            self.send_json(404, {"error": "接口不存在。"})
            return
        try:
            fields = read_form(self)
            knowledge = (fields.get("knowledge") or "").strip()
            if not knowledge:
                raise ValueError("知识点内容不能为空。")
            image_bytes = fields.get("image")
            if image_bytes is not None:
                result = create_knowledge_record(knowledge, image_bytes)
                self.send_json(201, result)
                return
            validate_generated_knowledge_input(knowledge)
            job_id = start_generation_job(knowledge)
            self.send_json(202, {"jobId": job_id, "status": "pending"})
        except (ValueError, RuntimeError, TimeoutError) as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            self.send_json(500, {"error": f"保存知识点失败：{error}"})

    def handle_admin_import(self):
        # 安全保护：必须携带与环境变量 IMPORT_TOKEN 一致的令牌。
        # 未配置 IMPORT_TOKEN 时拒绝执行，避免端点裸露。
        expected = os.getenv("IMPORT_TOKEN", "").strip()
        provided = self.headers.get("X-Import-Token", "").strip()
        if not expected:
            self.send_json(503, {"error": "未启用导入端点（需配置 IMPORT_TOKEN）。"})
            return
        if provided != expected:
            self.send_json(401, {"error": "令牌无效。"})
            return
        try:
            result = import_gallery_to_database()
            self.send_json(200, result)
        except Exception as error:
            self.send_json(500, {"error": f"导入失败：{error}"})

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    load_dotenv()
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "4173"))
    os.chdir(ROOT)
    server = ThreadingHTTPServer((host, port), MemPalaceHandler)
    print(f"MemPalace running at http://{host}:{port}", flush=True)
    server.serve_forever()