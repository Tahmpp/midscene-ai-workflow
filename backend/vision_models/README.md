# 传统视觉模型替换入口

这里是“截图不走大模型、走传统视觉识别”的集中入口，后续你要替换模型时，优先看这两个位置：

1. 匹配逻辑代码：`backend/workflow/services/traditional_vision_matcher.py`
2. 参考图库目录：`backend/vision_models/references/`

## 当前默认实现

- 当前使用的是 **dHash 感知哈希 + 汉明距离** 的轻量匹配方案（本地运行、无 token 成本）。
- 适合做“封面图/卡片图”的近似识别与比对。
- 后续你可以把 `TraditionalVisionMatcher` 替换成 OpenCV、CLIP、Siamese、Faiss 检索等任意实现，只要保留 `match_base64()` 输出结构即可。

## 参考图库组织方式

以电视剧识别为例（`category: tv_series`）：

```text
backend/vision_models/references/tv_series/
  ├─ 江湖正道/
  │   ├─ 1.jpg
  │   └─ 2.jpg
  ├─ 琅琊榜/
  │   └─ 1.jpg
  └─ ...
```

- 每个“标签（电视剧名）”是一个文件夹名。
- 文件夹里放该电视剧的封面/卡片参考图。

冬奥 EPG 里常见的 UI 素材识别建议放到 `ui_assets`（国旗/队标/角标/logo/默认图/广告图等）：

```text
backend/vision_models/references/ui_assets/
  ├─ 中国国旗/
  ├─ 队标/
  ├─ 金牌标识/
  ├─ 收费角标/
  ├─ 嘉宾logo/
  ├─ 默认图/
  ├─ 广告图/
  └─ ...
```

## YAML 用法（执行阶段）

在用例 `flow` 中新增步骤：

```yaml
- traditionalVisionAssert:
    category: tv_series
    target: 江湖正道
    minScore: 0.78
    topK: 3
```

- 通过：继续执行后续步骤。
- 失败：该步骤抛错，用例失败，并记录日志。

## 自动分流（无需改 YAML）

现在系统已支持：保留原有 `aiAssert` 写法不变，在运行时自动识别“找电视剧/封面匹配”类断言并分流到传统视觉。

- 开关环境变量：`AUTO_TRADITIONAL_VISION_ROUTING`（默认 `true`）
- 阈值环境变量：`TRADITIONAL_VISION_MIN_SCORE`（默认 `0.78`）
- TopK 环境变量：`TRADITIONAL_VISION_TOP_K`（默认 `3`）

当文本命中匹配意图且可提取目标剧名时，会记录日志：
- `aiAssert 自动分流 -> traditionalVisionAssert (...)`

## 给后续 AI 步骤传值（可选）

`traditionalVisionAssert` 的结果会保存到运行时上下文，可在后续 `ai` / `aiAssert` 中使用：

- `{{last_traditional_vision.best_label}}`
- `{{last_traditional_vision.best_score}}`
- `{{last_traditional_vision.top_matches}}`
