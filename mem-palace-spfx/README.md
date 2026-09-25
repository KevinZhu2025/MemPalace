# MemPalace SPFx WebPart

这是从现有静态版 MemPalace 迁移出的 SharePoint Framework WebPart。它保留了 CSV 解析、层级导航、记忆房间、详情抽屉和图片加载状态，并把数据源改成 SharePoint 可配置路径。

## SharePoint 资源约定

默认情况下 WebPart 会读取当前站点：

```text
/SiteAssets/MemPalace/知识点文档.csv
/SiteAssets/MemPalace/gallery/...
```

请把原项目中的 `知识点文档.csv` 上传到 SharePoint 文档库 `SiteAssets/MemPalace/`，并把 `gallery` 文件夹上传到 `SiteAssets/MemPalace/gallery/`。

CSV 的 `图片位置` 可以使用以下格式：

- `gallery/1.png`
- `/sites/YourSite/SiteAssets/MemPalace/gallery/1.png`
- `https://tenant.sharepoint.com/sites/YourSite/SiteAssets/MemPalace/gallery/1.png`

WebPart 属性面板提供两个配置项：

- `Asset base URL`：资源根目录，留空时使用当前站点的 `/SiteAssets/MemPalace`。
- `CSV URL`：CSV 地址，留空时使用资源根目录下的 `知识点文档.csv`。

## 本地开发

项目目录下已准备便携版 Node.js，`.tools` 已加入 `.gitignore`。在 PowerShell 中可以先临时加入当前会话 PATH：

```powershell
$env:PATH = "$PWD\.tools\node-v18.19.1-win-x64;$env:PATH"
```

如果在另一台机器上使用，也可以直接安装 Node.js 18 LTS。然后运行：

```powershell
npm install
npm run trust-dev-cert
npm run serve
```

## 打包发布

```powershell
npm run bundle:ship
npm run package:ship
```

生成的包位于：

```text
sharepoint/solution/mem-palace-spfx.sppkg
```

把 `.sppkg` 上传到 SharePoint App Catalog，批准部署后，在目标站点页面中添加 `MemPalace` WebPart。
