import os
import json
from openai import OpenAI
from backend.settings import BASE_DIR

# 默认示例文件路径
DEFAULT_EXAMPLE_EXCEL_PATH = os.path.join(BASE_DIR, '..', 'TV_test_1.xlsx')
DEFAULT_EXAMPLE_YAML_PATH = os.path.join(BASE_DIR, '..', 'TV_test_1.yaml')

class AIService:
    """
    AI 脚本生成服务
    使用 DeepSeek 模型生成测试脚本（文本生成能力强）
    """
    def __init__(self):
        # 使用火山引擎的 DeepSeek 模型进行脚本生成
        self.client = OpenAI(
            api_key=os.getenv("VOLCENGINE_API_KEY") or os.getenv("MIDSCENE_MODEL_API_KEY"),
            base_url=os.getenv("VOLCENGINE_API_BASE_URL") or os.getenv("MIDSCENE_MODEL_BASE_URL")
        )
        # 脚本生成使用 DeepSeek 模型
        self.model = os.getenv("GENERATION_MODEL_NAME", "deepseek-v3-2-251201")
        self._default_example = None
        
        print(f"[AIService] 初始化完成")
        print(f"[AIService] 脚本生成模型: {self.model}")
        print(f"[AIService] API Base URL: {self.client.base_url}")

    def _load_default_example(self):
        """Load default example files for few-shot learning."""
        if self._default_example is not None:
            return self._default_example
        
        try:
            import pandas as pd
            
            # Read default Excel
            if os.path.exists(DEFAULT_EXAMPLE_EXCEL_PATH):
                df = pd.read_excel(DEFAULT_EXAMPLE_EXCEL_PATH)
                excel_text = df.to_string()
            else:
                excel_text = None
            
            # Read default YAML
            if os.path.exists(DEFAULT_EXAMPLE_YAML_PATH):
                with open(DEFAULT_EXAMPLE_YAML_PATH, 'r', encoding='utf-8') as f:
                    yaml_text = f.read()
            else:
                yaml_text = None
            
            if excel_text and yaml_text:
                self._default_example = {
                    'excel': excel_text,
                    'yaml': yaml_text
                }
            else:
                self._default_example = False  # Mark as unavailable
                
        except Exception as e:
            print(f"Error loading default examples: {e}")
            self._default_example = False
        
        return self._default_example if self._default_example else None

    def generate_midscene_script(self, test_case_data, example_content=None):
        """
        Generates a Midscene YAML script from test case data.
        Supports few-shot learning with example content.
        
        Args:
            test_case_data: dict with title, description, steps, etc.
            example_content: optional dict with 'excel' and 'yaml' keys for few-shot learning
        """
        # Use provided example or fall back to default
        if example_content is None:
            example_content = self._load_default_example()
        
        prompt = self._construct_prompt(test_case_data, example_content)
        system_prompt = self._construct_system_prompt(example_content)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2
            )
            content = response.choices[0].message.content
            return self._extract_yaml(content)
        except Exception as e:
            print(f"AI Generation Error: {e}")
            return None

    def _construct_system_prompt(self, example_content=None):
        """Construct system prompt, optionally including few-shot example.

        特别要求：当目标平台是 Android TV 时，生成的脚本风格必须尽量贴近示例 TV_test_1.yaml，
        包括整体结构、字段命名和操作节奏。
        """
        base_prompt = """你是一名专业的 QA 自动化工程师，精通 Midscene.js/Midscene-Python 框架。
你的任务是将测试用例转换为 Midscene YAML 自动化脚本。
只返回 YAML 代码块内的内容。

=== 关键规则：静态断言 vs 动态断言 ===

【核心理解】AI 视觉模型只能看到"单张截图"，无法判断动态效果（如播放、切换、动画）。
因此，你必须区分"静态断言"和"动态断言"：

【静态断言】- 可以从单张截图判断的内容，使用 aiAssert：
  - 元素是否存在（"页面上有xxx按钮"）
  - 文字内容（"标题显示xxx"）
  - 布局位置（"导航栏在顶部"）
  - 焦点状态（"xxx按钮处于高亮状态"）
  - 颜色/样式（"背景是蓝色"）

【动态断言】- 需要观察变化才能判断的内容，必须使用"多帧对比"策略：
  - 视频播放（"正在播放"、"无卡顿"、"流畅"）
  - 动画效果（"翻转"、"切换"、"滚动"、"滑动"）
  - 内容轮播（"卡片会切换"、"轮播"）
  - 加载状态（"加载完成"、"刷新"）

【动态断言的正确写法】使用"截图A → 等待 → 截图B → 对比变化"的模式：

```yaml
# ❌ 错误：单帧无法判断"播放"和"切换"
- aiAssert: 视频正在播放，卡片会翻转切换

# ✅ 正确：拆分为静态检查 + 动态对比
# 第1步：静态检查当前状态
- aiAssert: 视频小窗有画面内容，不是黑屏或加载状态
# 第2步：记录当前画面特征  
- ai: 记住当前视频画面的内容
# 第3步：等待变化发生
- sleep: 3000
# 第4步：对比变化
- aiAssert: 视频画面与之前不同，说明正在正常播放

# ✅ 或者使用 aiWaitFor 等待条件成立
- aiWaitFor: 视频画面发生了变化
```

【常见动态场景的处理模板】

1. 视频播放检测：
```yaml
- aiAssert: 视频区域有画面，不是黑屏  # 静态：有画面
- sleep: 2000
- aiAssert: 视频画面与2秒前不同  # 动态：在播放
```

2. 卡片轮播/切换检测：
```yaml
- aiAssert: 页面上有内容卡片  # 静态：卡片存在
- sleep: 5000  # 等待自动切换
- aiAssert: 卡片内容已经变化，确认有轮播功能  # 动态：有切换
```

3. 动画效果检测：
```yaml
- ai: 触发动画效果
- sleep: 1000  # 等待动画完成
- aiAssert: 动画已完成，元素处于最终状态  # 静态：最终状态
```

=== 起始页面导航规则 ===

【重要】每个测试用例应该是独立的，不能依赖上一个用例执行后的页面状态。

【规则】
1. 如果"初始条件"中指定了需要先进入某个页面（如"进入免费专区页面"），则脚本开头需要先导航到该页面
2. 导航方式：优先使用首页键回到首页，再按步骤进入目标页面
3. 不要假设当前已经在某个页面上

【示例】
如果初始条件是"进入电视剧详情页"，脚本应该先：
```yaml
# 先回到首页
- aiKeyboardPress: Home
- sleep: 1000
# 再导航到目标页面
- ai: 切换到影视导航栏
- ai: 进入电视剧专区
- ai: 选择一部电视剧进入详情页
# 然后才是真正的测试步骤
```
"""

        # === Android TV 脚本结构规范（必须尽量贴近 TV_test_1.yaml） ===
        #
        # 下面这部分是对示例 TV_test_1.yaml 的结构抽象总结，你在生成 Android TV 用例脚本时
        # 必须严格遵守这些结构约束，而不是随意发明新的顶层结构或字段。
        base_prompt += """

=== Android TV 脚本结构规范（必须贴近示例 TV_test_1.yaml） ===

【顶层结构必须包含以下三个部分】：
1. android:
   - 必须包含 android.deviceId 字段，值可以使用占位符，例如:
     ```yaml
     android:
       deviceId: "192.168.1.xxx:5555"
     ```
   - 这里的 deviceId 只是模板占位，真实连接设备会由系统参数覆盖，你只需要保持字段名一致。

2. agent:
   - 必须包含 agent.aiActContext 字段，内容要和示例尽量一致，用于告诉 AI 这是 Android TV + 遥控器操作场景：
     ```yaml
     agent:
       aiActContext: "这是 Android TV 设备，使用遥控器方向键移动焦点（通过高亮框判断位置），Enter 键确认，Back 键返回。根据界面布局判断需要按几次方向键到达目标。"
     ```

3. tasks:
   - 为每一个逻辑子场景定义一个 task：
     - name: 简短描述，比如「首页焦点与小窗播放检查」「免费专区模块焦点与返回路径检查」
     - flow: 是一个步骤列表，每个元素都是「只包含一个键」的字典，例如：
       - ai
       - aiAssert
       - aiKeyboardPress
       - runAdbShell
       - sleep
       - traditionalVisionAssert（用于图片比对类任务，走传统视觉模型，避免视觉大模型 token 消耗）

【flow 内步骤的写法必须贴近 TV_test_1.yaml】：
- 每个 step 只做一件事，不要在同一个 ai 里混合「导航 + 校验 + 返回」等多个目标。
- 典型模式（请复用这种模式，而不是随意变形）：
  1. 用 aiAssert 做静态确认（例如当前在首页、小窗有画面）。
  2. 用 ai 描述「如何用方向键移动到目标卡片/模块」，让模型自己规划按键次数。
  3. 适当插入 sleep 控制节奏：
     - 页面大跳转（进入新页面）可以使用 2000ms 左右；
     - 焦点移动后的微小等待使用 500ms 左右；
     - 不要在每个步骤后都用 3000ms 以上的长等待。
  4. 用 aiAssert 明确描述「成功条件必须成立」：
     - 例如「焦点已成功移动到‘免费专区’模块入口上，焦点高亮正常显示」，
       不要只写成「看起来已经接近免费专区」这种模糊表述。
  5. 对于返回路径，优先使用 runAdbShell: input keyevent 4（Back 键），
     每次返回后用 aiAssert 明确当前页面和焦点应该落在什么位置。

【节奏和性能要求】：
- 为了让执行更流畅，请尽量减少不必要的 ai/aiAssert 次数：
  - 一个场景用 1~2 次 ai + 若干关键 aiAssert 即可；
  - 避免在非常细碎的每一步前后都调用 ai/aiAssert。
- 若任务是“根据图片/封面寻找特定电视剧”，优先使用 traditionalVisionAssert，不要用 aiAssert 做图片比对。
  示例：
  ```yaml
  - traditionalVisionAssert:
      category: tv_series
      target: 江湖正道
      minScore: 0.78
      topK: 3
  ```
- sleep 只在必要时使用，避免多次 3000ms 以上的长等待。

【总结】：
- 生成 Android TV 脚本时，你可以换用例内容、换卡片名称，但整体 YAML 结构、
  字段名和步骤组织方式应该和示例 TV_test_1.yaml 尽量一致。
"""
        
        if example_content:
            base_prompt += """

已为你提供了一个示例，展示如何将测试用例转换为 YAML 脚本。
请遵循示例的风格、结构和格式，同时应用上述动态/静态断言规则。
注意：
- YAML 结构和缩进
- 测试步骤如何转换为操作 (ai, aiAssert, traditionalVisionAssert, aiKeyboardPress, sleep 等)
- 断言的详细程度
- 平台特定配置 (android, web 等)
"""
        
        return base_prompt

    def _construct_prompt(self, data, example_content=None):
        prompt_parts = []
        
        # Add few-shot example if available
        if example_content:
            prompt_parts.append("""=== 参考示例 ===
以下是一个完整的示例，展示如何将测试用例转换为 YAML 脚本。
请参考这个示例的格式和风格。

--- 示例输入（Excel 测试用例）---
""")
            prompt_parts.append(example_content['excel'])
            prompt_parts.append("""

--- 示例输出（生成的 YAML 脚本）---
""")
            prompt_parts.append(example_content['yaml'])
            prompt_parts.append("""

=== 示例结束 ===

""")
        
        # 获取用例信息
        case_id = data.get('case_id', 'Unknown')
        title = data.get('title', '')
        description = data.get('description', '')
        preconditions = data.get('preconditions', '')
        steps = data.get('steps', '')
        expected_result = data.get('expected_result', '')
        
        # Add actual test case with clear structure
        prompt_parts.append(f"""
=== 当前任务 ===
请为以下【单个】测试用例生成 Midscene YAML 自动化脚本。

【重要】这是一个独立的测试用例，用例编号为 "{case_id}"。
请只为这一个用例生成脚本，不要生成其他用例的脚本。

--- 测试用例详情 ---
用例编号: {case_id}
测试模块: {title}
测试描述: {description}
前置条件: {preconditions}

测试步骤:
{steps}

预期结果:
{expected_result}

--- 生成要求 ---
1. 请严格按照上述测试步骤生成对应的 YAML 脚本
2. 脚本应该能够验证所有预期结果
3. 参考示例的格式和风格（如果有提供）
4. 只返回 YAML 代码，不需要其他解释
5. 用 ```yaml 和 ``` 包裹代码

【特别注意】动态效果的处理：
- 如果测试步骤涉及"播放"、"卡顿"、"切换"、"翻转"、"滚动"等动态效果
- 请使用"静态检查 + sleep + 对比变化"的模式
- 不要用单个 aiAssert 去判断动态过程
- 示例：
  ```yaml
  # 检测视频播放
  - aiAssert: 视频区域有画面内容
  - sleep: 2000
  - aiAssert: 视频画面已发生变化，确认正在播放
  ```

请生成:
""")
        
        return ''.join(prompt_parts)

    def _extract_yaml(self, content):
        if "```yaml" in content:
            return content.split("```yaml")[1].split("```")[0].strip()
        if "```" in content:
            return content.split("```")[1].split("```")[0].strip()
        return content.strip()
