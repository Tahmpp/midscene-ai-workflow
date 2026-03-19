# Midscene AI 自动化测试平台 — API 文档

**版本**：1.0  
**更新日期**：2026-02-13  
**Base URL**：`http://localhost:8000/api/`（开发环境）

---

## 1. 概述

所有接口均以 `/api/` 为前缀，使用 JSON 请求/响应（除上传为 `multipart/form-data`、SSE 为 `text/event-stream`）。下文路径均相对于 `/api/`。

---

## 2. 工作流配置相关

### 2.1 上传 Excel 测试用例

- **URL**：`POST /api/upload/`
- **Content-Type**：`multipart/form-data`
- **请求体**：`file`：Excel 文件（.xlsx / .xls）
- **响应**：`201 Created`，Body 为测试用例对象数组（含 `id`, `case_id`, `title`, `description`, `preconditions`, `steps`, `expected_result`, `priority`, `created_at`）
- **说明**：自动解析 Excel 并智能匹配中英文列名（用例编号、标题、描述、前置条件、步骤、预期结果、优先级），存在则更新、不存在则创建。

### 2.2 AI 生成脚本

- **URL**：`POST /api/generate/`
- **Content-Type**：`application/json` 或 `multipart/form-data`
- **请求体**：
  - `case_ids`：数组，必填，要生成脚本的用例编号
  - `example_excel`、`example_yaml`：可选，用于 few-shot 的示例 Excel 与 YAML 文件（仅 multipart 时传文件）
- **响应**：`200 OK`，Body 为生成的脚本对象数组（含 `id`, `test_case`, `yaml_content`, `status`, `error_message`, `created_at`, `updated_at`）

### 2.3 获取单个脚本

- **URL**：`GET /api/scripts/<case_id>/`
- **响应**：`200` 返回脚本对象；`404` 用例或脚本不存在

### 2.4 更新脚本

- **URL**：`PUT /api/scripts/<case_id>/update/`
- **请求体**：`{ "yaml_content": "..." }`
- **响应**：`200` 返回更新后的脚本对象；`400` 缺少 `yaml_content`；`404` 用例不存在

### 2.5 导入本地 YAML 脚本

- **URL**：`POST /api/execution/import/`
- **请求体**：`{ "scripts": [ { "file_name": "xxx.yaml", "content": "yaml 内容" }, ... ] }`
- **响应**：`200` 返回创建的测试用例数组；`400` 无 `scripts`

---

## 3. 执行与流式日志

### 3.1 启动执行

- **URL**：`POST /api/execution/start/`
- **请求体**：
  - `case_ids`：可选，数组，指定用例编号；不传则执行全部
  - `device_id`：可选，Android 设备 ID（如 `192.168.1.102:5555`）
- **响应**：`200`，`{ "run_id": 1, "status": "started", "message": "Execution started in background" }`

### 3.2 停止执行

- **URL**：`POST /api/execution/stop/`
- **请求体**：`{ "run_id": 1 }`
- **响应**：`200` 成功发送停止信号；`404` 未找到或未在运行

### 3.3 执行流（SSE 实时日志）

- **URL**：`GET /api/execution/stream/?run_id=<run_id>`
- **Content-Type**：`text/event-stream`
- **说明**：服务端持续推送 `data: {...}` 行。字段包括：`message`（日志）、`status`、`final`（是否结束）、`heartbeat`、`error`。客户端需使用 EventSource 或 fetch + 流式读取。

---

## 4. 报告与统计

### 4.1 报告列表（执行批次列表）

- **URL**：`GET /api/reports/`
- **响应**：`200`，TestRun 数组，按 `start_time` 倒序。每条含 `id`, `start_time`, `end_time`, `status`, `total_cases`, `passed_cases`, `failed_cases`, `results`（TestResult 列表，含 `test_case` 摘要、`status`, `duration`, `log_content`, `error_message`, `screenshot_path`, `video_path`, `report_path` 等）

### 4.2 报告详情（单次执行详情）

- **URL**：`GET /api/reports/<pk>/`
- **响应**：`200` 返回该次 TestRun 及全部 TestResult；`404` 不存在

### 4.3 报告文件列表

- **URL**：`GET /api/reports/files/`
- **响应**：`200`，数组，元素为 `{ "name", "path", "size", "modified" }`，路径为 `/api/reports/files/<name>`，最多 50 条

### 4.4 报告文件访问

- **URL**：`GET /api/reports/files/<filename>`
- **响应**：HTML 文件流（Content-Type: text/html）；`403` 非法路径；`404` 文件不存在

### 4.5 仪表盘统计

- **URL**：`GET /api/dashboard/stats/`
- **响应**：`200`，`{ "total_runs", "pass_rate", "defects", "avg_duration" }`

---

## 5. 数据模型摘要（供联调参考）

- **TestCase**：`id`, `case_id`, `title`, `description`, `preconditions`, `steps`, `expected_result`, `priority`, `created_at`
- **GeneratedScript**：`id`, `test_case`, `yaml_content`, `status`(pending/generating/completed/failed), `error_message`, `created_at`, `updated_at`
- **TestRun**：`id`, `start_time`, `end_time`, `status`(pending/running/completed/stopped), `total_cases`, `passed_cases`, `failed_cases`
- **TestResult**：`id`, `run`, `test_case`, `status`(pending/running/success/failed/skipped), `start_time`, `end_time`, `duration`, `log_content`, `error_message`, `screenshot_path`, `video_path`, `report_path`

---

## 6. 错误与状态码

- `400`：参数错误（如缺少必填字段）
- `404`：资源不存在（用例、脚本、run_id 等）
- `500`：服务器内部错误（如 AI 调用失败、数据库异常）
