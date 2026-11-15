# Foxmind 隐私政策

更新日期 2026-11-15

Foxmind 由 Foxmori-Official 提供，用于读取用户指定的网页内容、生成与保存摘要、导出网页及将资源交给用户配置的 Foxdown 服务。

## 处理的信息及用途

- 账户与配置。连接狐森主站时，扩展使用主站既有登录会话读取账户编号、邮箱或用户名、套餐分组，并取得用户选择分组的专用 API Key。扩展将账户显示信息、API Key、模型、界面偏好及 Foxdown 地址与可选令牌保存在当前浏览器的本地扩展存储。
- 网页与选区。用户开启「网页内容授权」并主动请求摘要时，扩展将页面标题、提取的正文或选中文字发送至 https://api.foxmori.com，用于调用所选模型生成摘要。AI 处理由狐森模型服务及所选模型对应的服务提供方完成，相关服务条款与数据处理说明应从狐森主站查阅。
- 摘要存档。普通窗口生成的摘要、引用原文、完整来源网址与生成时间保存在当前浏览器配置内，在切换狐森账户后仍可查看。存档用于本机搜索和回看，不由扩展自动同步至服务器。无痕窗口摘要使用会话存储，关闭对应窗口时清除。
- 资源与下载。用户打开侧边栏或刷新资源后，扩展可读取当前获授权网页的链接、媒体地址及必要网络请求信息。资源发现会暂存下载所需的 Cookie、Authorization、Referer、Origin 或 User-Agent 等请求头，具体以浏览器允许读取的信息为准。用户点击「发送到 Foxdown」时，扩展将资源链接、页面来源与适用请求头发送到用户配置的 Foxdown 服务器，用于完成该项下载。
- 页面导出。HTML 或 Markdown 导出在本机进行。导出的 HTML 可能保留外部图片、样式和媒体地址，打开文件时可向原网站请求这些资源。

## 数据共享与传输

摘要请求发送至狐森模型服务。主站账户操作使用 https://foxmori.com 的同源会话，扩展不会复制主站会话供模型 API 使用。下载任务仅交给用户配置的 Foxdown 服务；该服务由用户选择，可以位于本机或远程。远程服务的运营者可以收到用户主动提交的下载信息。

Foxmind 扩展不包含广告、行为分析或遥测代码，不通过扩展出售用户数据或将其用于个性化广告。用户数据仅用于上述用户可见功能。Foxmind 对通过 Google API 获取的信息的使用和转移遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。

## 保存与删除

用户可在设置中删除单条摘要或清空存档、移除本地 API Key、断开 Foxdown 连接。断开连接会清除保存的服务器地址与令牌。账户显示信息仍可能保留为「上次连接的账户」。卸载扩展会移除其浏览器扩展存储。已导出的文件及已提交至外部服务的数据需要分别在对应位置管理。

本地 API Key 和存档使用浏览器扩展存储，未另行添加应用层加密。扩展将本地配置限制为可信扩展上下文访问。狐森请求通过 HTTPS 传输；默认本机 Foxdown 服务通过回环 HTTP 访问。自定义远程 Foxdown 的传输安全由用户选择的服务地址决定。

## 联系与更新

隐私问题可通过 [GitHub Issues](https://github.com/Foxmori-Official/Foxmind/issues) 联系维护者。请勿在公开 Issue 中提交密钥、Cookie、个人网页内容或其他私密信息。政策将随数据处理方式变更更新。

---

# Foxmind Privacy Policy

Updated November 15, 2026.

Foxmind is provided by Foxmori-Official to summarize and save user-selected webpage content, export pages, and send resources to a user-configured Foxdown service.

## Information handled

Account identifiers, email addresses or usernames, subscription groups, API keys, model preferences and Foxdown connection details are handled to connect the services. Settings and credentials are stored in the current browser profile. Foxmori account operations use the existing first-party session at https://foxmori.com.

After enabling page content permission and explicitly requesting a summary, page titles and extracted page text or selections are sent to https://api.foxmori.com for the selected model. Processing is performed by Foxmori's model service and the applicable model provider. Refer to the Foxmori website for the selected service's terms and data handling information.

Normal-window summaries, quoted source passages, full source URLs and timestamps are saved in this browser profile. The local archive remains available after switching Foxmori accounts. The extension does not automatically synchronize archives to a server. Private-window summaries use session storage and are cleared when their window closes.

When resources are inspected on an authorized page, resource URLs and necessary request information may be temporarily stored. This can include Cookie, Authorization, Referer, Origin and User-Agent headers allowed by the browser. Clicking Send to Foxdown sends the selected resource URL, page source and applicable headers to the configured Foxdown server. Its operator may receive those submitted details.

Page export runs locally. Opening exported HTML can request externally referenced assets from the original websites.

## Use and sharing

Data is used for the visible features described above. The extension contains no advertising, analytics or telemetry code and does not sell user data or use it for personalized advertising. Foxmind's use and transfer of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Foxmori requests use HTTPS. The default local Foxdown server uses loopback HTTP. Transport security for a remote Foxdown service depends on its configured URL.

## Retention and deletion

Delete individual summaries or clear the archive in Settings. Remove the local API key or disconnect Foxdown to remove its saved URL and token. Last connected account details may remain visible. Uninstalling the extension removes its extension storage. Exported files and data already submitted to other services must be managed separately.

Local credentials and archives use browser extension storage without additional application-layer encryption. Configuration storage is restricted to trusted extension contexts.

## Contact

Contact the maintainers through [GitHub Issues](https://github.com/Foxmori-Official/Foxmind/issues). Do not post credentials, cookies or private webpage contents in public issues. This policy will be updated when data handling changes.
