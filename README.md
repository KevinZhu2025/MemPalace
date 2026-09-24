# MemPalace
Web pages for assistanting memo knowledges
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

图片生成服务使用阿里云百炼原生异步文生图接口和 `qwen-image-3.0` 模型。

# 图片生成

图片生成由本地 Python 脚本执行，不在浏览器中暴露 API 密钥。脚本只处理“图片位置”为空、且“图像提示词”不为空并且不等于“无”的行，使用 `qwen-image-3.0` 提交异步生成任务，轮询完成后将 PNG 保存到 `gallery`，并将相对路径写回 CSV。

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

生成成功的文件会保存为 `gallery/图片编号.png`，CSV 的“图片位置”列会写入对应相对路径。失败项目保持空白并记录到 `image-generation.log`，下一次运行可以重试。CSV 原文件会先备份为 `知识点文档.csv.bak`。
