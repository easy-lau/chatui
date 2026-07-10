# ChatUI v1.3.74

相对上一个正式版本 **v1.3.73**，本版本在保留可配置 Endpoint、Docker 出站代理和脱敏网络诊断能力的基础上，重点修复图片编辑请求、图片意图路由与上游 HTTP 错误反馈。

## 新增

- 新增图片编辑命令识别规则，用于区分“请把背景换成蓝色”等明确编辑指令与“这张图片有什么修改建议”等视觉问答。
- 新增图片上游 HTTP 错误状态保留能力：上游响应解析会记录 401、403、429 等状态，供任务错误层生成准确提示。
- 新增 Docker/Node 上游连接诊断：支持识别 `ECONNRESET`、`ETIMEDOUT`、`UND_ERR_CONNECT_TIMEOUT`、`ENOTFOUND`、`EAI_AGAIN`、`ECONNREFUSED`。
- 新增公共上游代理配置 `CHATUI_UPSTREAM_PROXY`，并支持 `HTTPS_PROXY` / `HTTP_PROXY` 作为后备；新增 `CHATUI_VERBOSE_LOGS=1` 脱敏诊断日志。

## 删除

- 删除图片编辑 multipart 请求中手工设置的 `Content-Length` 请求头，改由 Node `fetch`/undici 根据 Buffer 自动计算，避免请求在发送前被 `UND_ERR_INVALID_ARG` 拒绝。
- 删除服务端强制覆盖客户端 Endpoint Base URL 的行为；服务端默认地址仅作为旧客户端未传 `baseUrl` 时的兼容兜底。

## 修改

- Endpoint Base URL 恢复为可编辑配置，保存和提交时会规范化末尾斜杠；图片生成与图片编辑会使用用户实际配置的上游地址。
- 当前消息带图时，路由结果会结合明确编辑命令与视觉理解意图进行二次校正；提示词反推、图片分析和修改建议不再被误送到图片编辑接口。
- 图片任务错误文案按认证失败、权限不足、限流/额度、网络连接和上游业务错误分类展示，减少笼统“接口不可达”提示。
- 公网上游请求可通过容器可达的 HTTP(S) 代理发送；私有上游继续使用直连路径并保留 URL/DNS 安全校验。
- 上游失败日志仅记录目标主机/路径、请求体字节数、图片部分数量和底层网络错误链，不记录 API Key、Authorization 或图片 Base64 数据。

## 修复

- 修复图片编辑 multipart Buffer 同时携带显式 `Content-Length` 时被 undici 在本地拒绝、请求无法到达上游的问题。
- 修复图片问答、图片分析、提示词反推被路由模型误判为 `image_edit` 后错误调用图片编辑接口的问题，同时保留明确图片编辑指令的原有行为。
- 修复上游返回 401、403、429 时被统一包装为网络连接失败的问题，现在会分别提示 API Key、模型权限或额度/频率原因。
- 修复自定义 Endpoint 被服务端固定网关覆盖，导致文本与图片任务访问不同上游的问题。
- 修复 Docker 环境中代理、DNS、连接重置或超时原因被通用 `fetch failed` 隐藏、难以定位“文本正常但带图失败”的问题。

## 验证

- `npm test`
- `git diff --check`
