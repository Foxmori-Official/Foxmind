<div align="center">
  <img src="public/icons/foxmind.svg" alt="" width="80" height="80">
  <h1>Foxmind</h1>
  <p>在浏览器侧边栏总结网页和选中文字，保存摘要、导出网页，联动 Foxdown 下载资源</p>
  <p><a href="https://github.com/Foxmori-Official/Foxmind/releases/latest">下载安装包</a> · <a href="#快速安装">安装步骤</a> · <a href="docs/README.en.md">English</a></p>
</div>

## 快速安装

1. 从发布附件下载并解压 foxmind-0.0.2.zip。[GitHub 最新发布](https://github.com/Foxmori-Official/Foxmind/releases/latest)
2. 打开 Chrome 的 chrome://extensions 或 Edge 的 edge://extensions，开启开发者模式，点击「加载已解压的扩展程序」，选择包含 manifest.json 的文件夹。
3. 按安装引导选择 AI 服务。使用狐森时，打开 [foxmori.com](https://foxmori.com/#models) 登录，返回后读取账户、选择套餐分组并获取密钥；也可填写主站已有的 API Key。使用第三方时，选择「自定义 AI 服务」并配置接口。
4. 选择可用的对话模型，开启「网页内容授权」。将 Foxmind 固定到工具栏，打开普通网页后点击图标，再在侧边栏点击「总结当前页」。

再次点击工具栏图标可关闭侧边栏。扩展声明最低支持 Chrome / Edge 116，当前版本使用 Chromium 自动验收。浏览器限制注入的页面无法提取正文，资源发现需要相应网站访问权限。

升级时将新版文件复制到原扩展目录，在扩展管理页点击「重新加载」，再刷新已打开的网页。每个下载包的功能以对应版本的[发布说明](https://github.com/Foxmori-Official/Foxmind/releases)为准。

## 可以用它做什么

- **总结网页**。生成概览与要点，展开「查看原文」阅读对应的引用段落。切换标签页或站内跳转后保留已完成的摘要，主动请求新摘要后更新。
- **总结选中文字**。在摘要和资源之间使用独立的「选区摘要」，整页摘要和选区结果可以同时查看。
- **回看摘要存档**。在设置右侧按标题、网址、摘要或原文依据搜索，打开记录查看详情，或删除单条、清空存档。
- **导出网页**。在侧边栏将当前页保存为 HTML 或 Markdown。HTML 保存静态页面并沿用外部图片、样式地址，Markdown 保存可见主要内容和链接结构。
- **发现下载资源**。查看网页附件和有权读取的媒体资源，通过服务器地址将任务发送给 Foxdown。

界面提供简体中文和英语。首次安装使用居中的引导，设置页左侧展示账户、模型和 Foxdown，右侧展示摘要存档。

## 自定义 AI 服务

在设置的「AI 服务」中选择「自定义 AI 服务」。填写兼容 OpenAI Chat Completions 的 API 地址、API Key 和模型 ID，点击「保存服务」并允许访问所填服务。

- API 地址可填写包含版本路径的基地址，例如 https://api.example.com/v1。只有域名时自动补上 /v1，粘贴以 /chat/completions 结尾的地址时会转换为基地址。
- 「读取模型」请求服务的 /models 接口。服务没有模型列表时，可直接填写模型 ID 并保存。
- 本地或自托管服务如无需验证，可将 API Key 留空。
- 狐森和自定义服务的配置分别保存。切换服务或修改 API 地址后，需要重新开启网页内容授权。设置与侧边栏会显示当前摘要服务。

第三方摘要请求直接发送到配置的服务地址。该服务需要支持 /chat/completions、非流式 messages 请求，以及返回模型生成的 JSON 摘要。

## 连接 Foxdown

1. 启动 [Foxdown](https://github.com/Foxmori-Official/Foxdown)，在 Foxmind 设置中填写服务器地址，默认本机地址为 http://127.0.0.1:16801。
2. 如果服务器设置了 Web API Token，填入同一个令牌。点击「连接并保存」，允许访问所填服务器。
3. 打开网页，在侧边栏查看资源。流媒体可在开始播放后刷新列表，点击「发送到 Foxdown」创建下载任务。

Foxmind 可以独立安装。配置 Foxdown 后通过其服务器接口发送下载任务。

## 隐私

[完整隐私政策](PRIVACY.md)

摘要需要开启「网页内容授权」并主动点击总结按钮，网页标题和提取的文字会发送到当前选择的 AI 服务。普通窗口的摘要、引用原文和完整来源网址保存在当前浏览器的本机存档中，切换狐森账户或 AI 服务后仍可查看。无痕窗口的摘要保留到该窗口关闭。

API Key 和设置保存在本机扩展存储。页面导出在本机完成。发送下载时，会向所配置的 Foxdown 服务器传递资源地址和下载所需的请求头。

## 从源码构建

使用 Node.js 26 和 npm，构建后在扩展管理页加载 dist。

~~~sh
git clone https://github.com/Foxmori-Official/Foxmind.git
cd Foxmind
npm ci
npm run build
~~~

验证与打包命令如下。

~~~sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
npm run package
~~~

浏览器验收使用隔离的临时账户、模型和 Foxdown 接口夹具。Linux 无桌面环境时使用 xvfb-run --auto-servernum npm run test:browser。GitHub Actions 验证源码、构建 ZIP 并生成 SHA256SUMS.txt 后发布 Release。

## 致谢与许可

Foxmind 使用 GPL-3.0 许可，第三方代码遵循各自许可证。[许可证](LICENSE)

感谢以下项目的作者与贡献者。

- [Mozilla Readability](https://github.com/mozilla/readability) · 网页正文提取。
- [Turndown](https://github.com/mixmark-io/turndown) 和 [Turndown GFM](https://github.com/mixmark-io/turndown-plugin-gfm) · HTML 到 Markdown 转换。
- [ChatGPT-Box](https://github.com/ChatGPTBox-dev/chatGPTBox) · 网页提取与侧边栏交互参考。
