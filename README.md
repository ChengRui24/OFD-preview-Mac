# OFD-preview-Mac

macOS 上的 OFD 预览与转换小工具：双击打开 `.ofd`、预览页面，并可导出 PDF / PNG / SVG。

基于开源库 [OFDRW](https://github.com/ofdrw/ofdrw)（Apache License 2.0）构建。

## 在线预览（GitHub Pages）

无需安装，用浏览器打开：

https://chengrui24.github.io/OFD-preview-Mac/

拖入 `.ofd` 即可预览，并导出 PNG / PDF / SVG。文件只在本地浏览器处理，不会上传。字体按「文件内嵌 → 本机字体 → 在线按用字下载」装入浏览器：内嵌字体会先裁成实际用到的字；可点「读取本机字体」用电脑里的楷体/宋体；否则在线加载霞鹜文楷、Noto Serif SC、Noto Sans SC。复杂签章与桌面版可能有差异。

## 安装

### Homebrew（推荐）

```bash
brew tap ChengRui24/ofd
brew trust ChengRui24/ofd          # Homebrew 对第三方 tap 需要先信任
brew install --cask ofd-preview
```

升级 / 卸载：

```bash
brew upgrade --cask ofd-preview
brew uninstall --cask ofd-preview
```

> 需要 **Apple Silicon (arm64)**。Cask 维护在 [ChengRui24/homebrew-ofd](https://github.com/ChengRui24/homebrew-ofd)。

### 手动下载

1. 打开本仓库 [Releases](https://github.com/ChengRui24/OFD-preview-Mac/releases) 页面  
2. 下载最新的 [`OFD-Preview-macOS-arm64.zip`](https://github.com/ChengRui24/OFD-preview-Mac/releases/latest/download/OFD-Preview-macOS-arm64.zip)  
3. 解压后，将 **OFD预览.app** 拖到「应用程序」文件夹  

### 若提示「无法打开，因为来自身份不明的开发者」

当前发布包**未做 Apple 公证**，属正常现象。任选其一：

- 在 App 图标上 **右键 → 打开 → 打开**  
- 或：系统设置 → 隐私与安全性 → 仍要打开  

### 设为 .ofd 默认打开方式

1. Finder 中右键任意 `.ofd` → **显示简介**  
2. 「打开方式」选择 **OFD预览** → **全部更改…**  

之后双击 `.ofd` 即可用本 App 预览。

## 功能

- 打开 / 拖入 / 双击关联打开 OFD 并预览  
- 翻页预览  
- 导出 **PDF / PNG / SVG**（保存前可选择路径并重命名；同名文件会确认是否覆盖）  
- 提取文字、查看文档信息  
- 常见中文字体名映射（如「华文楷体」→ 系统楷体），减轻未嵌字 OFD 的乱字问题  

命令行（开发者可选）：

```bash
ofd info     文件.ofd
ofd text     文件.ofd
ofd to-pdf   文件.ofd [输出.pdf]
ofd to-image 文件.ofd [输出目录或格式]
ofd to-svg   文件.ofd [输出目录]
```

## 从源码构建

环境：macOS（Apple Silicon）、JDK 17+、Maven 3.8+。

```bash
git clone https://github.com/ChengRui24/OFD-preview-Mac.git
cd OFD-preview-Mac
./scripts/package-mac-app.sh    # 生成并安装到 /Applications
./scripts/make-release.sh       # 生成 release/*.zip 供发布
```

## 致谢与许可

- 核心 OFD 能力来自 [ofdrw/ofdrw](https://github.com/ofdrw/ofdrw)  
- 本项目以 **Apache License 2.0** 发布，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)  

```
Copyright 2026 ChengRui24
```

## 系统要求

- macOS（当前 Release 为 **Apple Silicon / arm64**）  
- 不额外安装 Java（App 内已打包运行时）  
