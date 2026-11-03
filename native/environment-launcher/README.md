# BioInfoBuddy 环境启动器

网页的“在终端安装”打开 `bioinfobuddy://install/<id>`，由用户安装的启动器接收，并在本机终端执行对应环境的安装。

## 使用

1. 在“环境配置”下载对应系统的启动器并解压。
2. macOS 打开 `BioInfoBuddy Launcher.app`；Windows 双击 `install.cmd`。
3. 回到网页，点击环境卡片的“在终端安装”。终端显示安装结果和进入环境的命令。

macOS 需要 Apple Silicon、macOS 13 或更高版本；Windows 需要 x86-64。

## 实现

`catalog.json` 是两平台共享的安装清单。四组环境由 V1.0 的原始配置整理，两个案例依赖来自现有复现包。R 保留 4.4.3，Windows Scanpy 保留 1.12.1；其余依赖按原配置的版本范围解析。

启动器复用已有 Conda，或从官方地址下载固定版本 Miniconda 并校验 SHA-256。环境使用应用专属 prefix，软件源通过每条命令传入。安装请求串行执行；安装成功后输出激活命令，失败保留终端错误信息。

协议接收器只接受清单内的本平台 ID。安装包携带清单与执行器，网页传入环境 ID。

## 构建与验证

```sh
python3 native/environment-launcher/macos/build.py
python3 native/environment-launcher/macos/test.py
python3 native/environment-launcher/windows/build.py
npm run test:launcher
```

macOS 构建需要 Xcode Command Line Tools。产物写入 `web/public/resources/launcher/`。Windows 脚本测试位于 `windows/tests.ps1`，独立 CI 在 Windows PowerShell 5.1 和 PowerShell 7 中执行。

macOS 当前产物采用 ad-hoc 签名。正式分发需要 Developer ID 签名与 Apple 公证；当前包的首次打开步骤见包内安装说明。
