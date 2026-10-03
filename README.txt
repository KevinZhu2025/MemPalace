#背景
要深入学习多门课程，各门功课知识点庞大且复杂，为了帮助能够快速牢固记忆知识点，希望开发一项工具来实现这个目的。
利用记忆宫殿的原理，通过图片，文字联想的方法来记忆知识点。其核心思想是创建网页，以房间代表课程，通过不断探索房间里的物品甚至下个房间来串联知识点。知识点和知识之间的层次关系来自知识库，通过文生图的方式创建图片，知识点和图片建立连接关系，然后展示在网页上。可以通过手机和电脑登陆。

#说明
##知识点的格式如下
图像提示词,图片位置,图片层级,图片编号,上层图片,知识点
英国古堡，大门刻上“英语”文字,,1,1,无,
"老旧扶手椅上坐着一位官僚，胸前贴着姓名“DYH""",,2,1.1,1,Clumsy bureaucracy  institutionalized by constitution causes systemic dysfunction and leads the country into the mire.

##字段解释
- 图像提示词，生成图片的提示词。
- 图片位置，为节省token，每次只为图片位置为空的行生成一次图片，然后保存和保留文件路径，网页生成的时候直接拉取图片。
- 图片层级 1标识首页展示。大于1的数字都表示是子页面。
- 图片编号是图片的唯一编码
-上层图片表示子页面链接的上一级页面的图片编号。
- 知识点是以图片漂浮的形式呈现的文字内容

# MVP 网页

## 启动

网页使用浏览器加载 CSV，因此不能直接双击 `index.html` 运行。请在本目录启动一个静态 HTTP 服务，例如：

```powershell
python -m http.server 4173
```

然后访问 `http://localhost:4173/`。

## 当前功能

- 首页展示所有 `图片层级 = 1` 的课程入口。
- 点击课程进入记忆房间，子节点由 `上层图片` 构建。
- 有子节点的卡片进入下一层，没有子节点的卡片打开知识点详情。
- 桌面端和手机端均支持面包屑、返回和详情面板。
- `图片位置` 为空时显示“待生成”状态，不影响知识点导航。
- 当前网页只读 CSV，不修改知识库。

## CSV 约束

CSV 必须包含以下字段：`图像提示词`、`图片位置`、`图片层级`、`图片编号`、`上层图片`、`知识点`。

网页会校验重复编号、非法父级、循环引用和父子层级不连续。`上层图片` 为 `无` 时表示根节点。图片生成完成后，将生成文件的相对路径或 URL 写入 `图片位置` 即可由网页加载。

网页新增知识点的生成 API 使用火山方舟；独立的批量补图脚本仍使用阿里云百炼。

# 网页后端方舟配置

`server.py` 启动时会读取项目根目录的 `.env`。配置火山方舟 API Key、API 根地址，以及该 Key 可访问的文本和图片模型或推理接入点 ID。

使用火山方舟 Agent Plan 时，必须在 Agent Plan 控制台获取该套餐专属 API Key，并使用
包含 `/api/plan/v3` 的专属 API 地址；不能混用标准方舟 `/api/v3` 地址或其他套餐的
API Key。当前后端会在该地址后追加 `/chat/completions` 和 `/images/generations`。

```dotenv
ARK_API_KEY=Agent_Plan_专属_API_Key
ARK_API_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
ARK_TEXT_MODEL=Agent_Plan_已启用的文本模型名称
ARK_IMAGE_MODEL=doubao-seedream-5.0-pro
# 图片生成请求的默认超时秒数。
ARK_REQUEST_TIMEOUT_SECONDS=180
# 文本模型可能较慢；生成任务会在后台运行，默认最多等待 300 秒。
ARK_TEXT_REQUEST_TIMEOUT_SECONDS=300
ARK_IMAGE_DOWNLOAD_TIMEOUT_SECONDS=60
```

`ACCESS_KEY_ID` 和 `SECRET_ACCESS_KEY` 不用于方舟模型 API 鉴权。使用 `python server.py` 启动网页后端。

Azure Web App 中不要直接设置 `ARK_API_KEY`。应将 Agent Plan 专属 API Key 保存为
Key Vault Secret `ark-api-key`，应用通过托管身份读取它。更新 Secret 后需重启 Web App，
以清除进程中的密钥缓存。

对于没有上传图片的知识点，网页会创建后台生成任务并每 3 秒查询一次状态，最长等待
15 分钟。这样长时间的文本或图片模型调用不会被 Azure Web App 的单次 HTTP 请求时限中断。
后台任务保存在当前应用进程内；如果 Web App 在任务完成前重启，该任务会失败，需要重新提交。

# Azure Web App 部署

建议使用 Linux Python Web App。项目不需要在 Azure 中保存 `.env`，生产配置应写入
Web App 的“环境变量/应用设置”。

## 运行配置

- 启动命令：`python server.py`
- 健康检查路径：`/healthz`
- `server.py` 默认监听 `0.0.0.0`，并读取 Azure Web App 提供的 `PORT`。
- 部署包必须包含 `server.py`、`requirements.txt`、`index.html`、`app.js`、
  `styles.css`、`gallery` 和 `知识点文档.csv`。

## 托管身份和 Key Vault

1. 在 Web App 的“标识”中开启系统分配的托管身份。
2. 在 Key Vault 中给该托管身份授予 `Key Vault Secrets User` 角色；如果 Key Vault
   使用旧式访问策略，则授予 Secrets 的 `Get` 权限。
3. Key Vault 中保留以下 Secret：
   - `azure-sql-password`
   - `ark-api-key`
4. Web App 应用设置中配置：
   - `AZURE_KEY_VAULT_URL`
   - `AZURE_SQL_SERVER`
   - `AZURE_SQL_DATABASE`
   - `AZURE_SQL_USER`
   - `ARK_API_BASE_URL`
   - `ARK_TEXT_MODEL`
   - `ARK_IMAGE_MODEL`

`DefaultAzureCredential` 会在 Azure Web App 中自动使用托管身份读取 Key Vault，
不需要配置 Tenant ID、Client ID 或 Client Secret。

## 上线验证

1. 访问 `/healthz`，应返回 `{"status": "ok"}`。
2. 访问 `/api/knowledge`，应返回 Azure SQL 中的知识点数组。
3. 打开首页，顶部数据源应显示“Azure SQL 知识库”而不是“本地 CSV 备用数据源”。
4. 提交一个测试知识点，确认文本模型、图片模型、图片保存和数据库写入均成功。

图片数据保存在 Azure SQL 的 `Knowledge_doc.[图片数据]` 列，网页通过
`/api/images/<图片编号>` 读取 PNG。GitHub Actions 重新部署不会删除已生成图片。
`图片位置` 保存对应 API 地址，不再依赖 Web App 本地 `gallery` 目录。

## Azure SQL 图片迁移

首次切换前，先在 Azure SQL Query Editor 中运行：

```sql
scripts/migrate_images_to_sql.sql
```

该脚本会新增 `图片数据 VARBINARY(MAX)` 与 `图片MIME类型 NVARCHAR(100)`，并删除原图
不可恢复的测试记录 `1.7`、`1.8`。随后在具备 Web App 托管身份和 Key Vault 访问权限的
运行环境执行：

```bash
python scripts/import_gallery_to_sql.py
```

导入脚本会把仓库中现有的 `gallery/*.png` 写入 Azure SQL，并将既有图片路径更新为
`/api/images/<图片编号>`。只有迁移和导入都成功后，才可从仓库移除旧的 PNG 文件。

# 图片生成

批量图片生成由本地 Python 脚本执行，不在浏览器中暴露 API 密钥。脚本只处理“图片位置”为空、且“图像提示词”不为空并且不等于“无”的行，使用 `qwen-image-3.0` 提交异步生成任务，轮询完成后将 PNG 保存到 `gallery`，并将相对路径写回 CSV。

## 安装依赖

本脚本只使用 Python 标准库，无需额外安装依赖。

在当前 PowerShell 会话设置 API 密钥：

```powershell
$env:DASHSCOPE_API_KEY = "你的阿里云百炼 API 密钥"
# 可选：按 API Key 所属地域设置百炼 API 根地址
$env:DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com"
```

先进行不调用 API 的检查：

```powershell
& "D:\Minforge3\python.exe" scripts\generate_images.py --dry-run
```

确认提示词后执行生成：

```powershell
& "D:\Minforge3\python.exe" scripts\generate_images.py
```

批量补图脚本仍会在本地生成 `gallery/图片编号.png` 供审核；要使其在线展示，需再运行
`scripts/import_gallery_to_sql.py` 导入 Azure SQL。失败项目保持空白并记录到
`image-generation.log`，下一次运行可以重试。CSV 原文件会先备份为 `知识点文档.csv.bak`。
