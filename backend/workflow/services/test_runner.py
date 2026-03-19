import threading
import queue
import time
import yaml
import json
import asyncio
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from loguru import logger
from django.utils import timezone
from django.conf import settings
from dotenv import load_dotenv
from asgiref.sync import sync_to_async
from .traditional_vision_matcher import TraditionalVisionMatcher

# 确保环境变量被加载
load_dotenv()

print(f"[TestRunner] MIDSCENE_AI_API_KEY: {'已设置' if os.getenv('MIDSCENE_AI_API_KEY') else '未设置'}")
print(f"[TestRunner] MIDSCENE_AI_MODEL: {os.getenv('MIDSCENE_AI_MODEL', '未设置')}")

from ..models import TestRun, TestResult, TestCase, GeneratedScript

# 报告输出目录
REPORTS_DIR = Path(settings.BASE_DIR) / 'reports'
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Global queues for log streaming: run_id -> Queue
LOG_QUEUES = {}
# Global stop events: run_id -> Event
STOP_EVENTS = {}
# Global runtime contexts: run_id -> dict
RUN_CONTEXTS = {}


class TestRunnerService:
    def __init__(self):
        self.traditional_vision_matcher = TraditionalVisionMatcher()

    def execute_run(self, run_id, case_ids=None, device_id=None):
        """
        Start a test run in a background thread.
        
        Args:
            run_id: 测试运行 ID
            case_ids: 可选的测试用例 ID 列表
            device_id: 可选的 Android 设备 ID（例如 "192.168.1.102:5555"）
        """
        # Initialize queue and stop event
        LOG_QUEUES[run_id] = queue.Queue()
        STOP_EVENTS[run_id] = threading.Event()
        RUN_CONTEXTS[run_id] = {}
        
        thread = threading.Thread(target=self._run_thread, args=(run_id, case_ids, device_id))
        thread.daemon = True
        thread.start()

    def _run_thread(self, run_id, case_ids, device_id=None):
        """
        The main execution loop running in a thread.
        
        Args:
            run_id: 测试运行 ID
            case_ids: 可选的测试用例 ID 列表
            device_id: 可选的用户指定的 Android 设备 ID
        """
        run = TestRun.objects.get(id=run_id)
        run.status = 'running'
        run.start_time = timezone.now()
        run.save()

        # Configure logger to capture logs for this run
        sink_id = logger.add(
            lambda msg: self._log_sink(run_id, msg),
            format="{time:HH:mm:ss} | {level} | {message}",
            level="INFO"
        )
        
        try:
            # Filter test cases
            if case_ids:
                results = list(run.results.filter(test_case__case_id__in=case_ids).select_related('test_case', 'test_case__script'))
            else:
                results = list(run.results.all().select_related('test_case', 'test_case__script'))

            # 检测第一个用例的脚本类型（Android 或 Web）
            first_result = results[0] if results else None
            if first_result and first_result.test_case.script:
                yaml_content = first_result.test_case.script.yaml_content
                try:
                    data = yaml.safe_load(yaml_content)
                    is_android = 'android' in data if isinstance(data, dict) else False
                except:
                    is_android = False
            else:
                is_android = False

            if is_android:
                # Android TV 测试（使用用户指定的 device_id 或从脚本中获取）
                self._run_android_tests(run, results, run_id, user_device_id=device_id)
            else:
                # Web 测试
                self._run_web_tests(run, results, run_id)

        except Exception as e:
            logger.error(f"Test Run Critical Error: {e}")
            import traceback
            traceback.print_exc()
            run.status = 'failed'
            run.error_message = str(e)
        finally:
            if STOP_EVENTS.get(run_id) and STOP_EVENTS[run_id].is_set():
                run.status = 'stopped'
            elif run.status == 'running':
                run.status = 'completed'
            
            run.end_time = timezone.now()
            run.save()
            
            # 发送最终状态日志
            self.emit_log(run_id, f"=== 测试执行结束，状态: {run.status} ===")
            
            # Cleanup（延迟清理队列，让 SSE 有机会读取最终状态）
            logger.remove(sink_id)
            if run_id in STOP_EVENTS:
                del STOP_EVENTS[run_id]
            if run_id in RUN_CONTEXTS:
                del RUN_CONTEXTS[run_id]
            # 注意：LOG_QUEUES 由 SSE 流在结束时清理

    def _run_android_tests(self, run, results, run_id, user_device_id=None):
        """运行 Android TV 测试
        
        Args:
            run: TestRun 对象
            results: TestResult 列表
            run_id: 运行 ID
            user_device_id: 用户在前端输入的设备 ID（优先使用）
        """
        self.emit_log(run_id, "检测到 Android TV 测试脚本")
        
        # 预先提取所有需要的数据（在同步上下文中）
        test_data = []
        script_device_id = None  # 脚本中定义的设备 ID
        
        for result in results:
            script = result.test_case.script
            if script:
                yaml_content = script.yaml_content
                data = yaml.safe_load(yaml_content)
                
                # 获取设备 ID（从第一个脚本，作为备用）
                if script_device_id is None and isinstance(data, dict) and 'android' in data:
                    script_device_id = data['android'].get('deviceId')
                
                test_data.append({
                    'result_id': result.id,
                    'case_id': result.test_case.case_id,
                    'yaml_data': data,
                })
            else:
                test_data.append({
                    'result_id': result.id,
                    'case_id': result.test_case.case_id,
                    'yaml_data': None,
                    'error': "No generated script found for this test case"
                })
        
        # 优先使用用户指定的设备 ID，其次使用脚本中的
        device_id = user_device_id or script_device_id
        
        if user_device_id:
            self.emit_log(run_id, f"使用用户指定的设备: {user_device_id}")
        
        # 创建新的事件循环
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # 执行 async 测试，传入预提取的数据
            execution_results = loop.run_until_complete(
                self._run_android_tests_async(test_data, device_id, run_id)
            )
            
            # 在同步上下文中更新数据库
            for exec_result in execution_results:
                result_obj = TestResult.objects.get(id=exec_result['result_id'])
                result_obj.status = exec_result['status']
                result_obj.error_message = exec_result.get('error_message', '')
                result_obj.start_time = exec_result.get('start_time')
                result_obj.end_time = exec_result.get('end_time')
                result_obj.report_path = exec_result.get('report_path')  # 保存报告路径
                if result_obj.start_time and result_obj.end_time:
                    result_obj.duration = (result_obj.end_time - result_obj.start_time).total_seconds()
                result_obj.save()
                
                # 更新统计
                if exec_result['status'] == 'success':
                    run.passed_cases += 1
                elif exec_result['status'] == 'failed':
                    run.failed_cases += 1
                run.save()
                
        finally:
            loop.close()

    async def _run_android_tests_async(self, test_data, device_id, run_id):
        """异步运行 Android 测试（不访问数据库）"""
        from midscene.android import AndroidAgent, AndroidDevice
        
        device = None
        agent = None
        execution_results = []
        
        try:
            # 尝试智能匹配设备 ID
            final_device_id = None
            
            # 1. 获取当前已连接设备列表
            connected_devices = await AndroidDevice.list_devices()
            self.emit_log(run_id, f"当前已连接 ADB 设备: {connected_devices}")

            if device_id:
                # 用户指定了设备 ID
                # 尝试精准匹配
                if device_id in connected_devices:
                    final_device_id = device_id
                else:
                    # 尝试模糊匹配（处理端口号差异）
                    # 例如用户输入 192.168.1.103，列表是 192.168.1.103:5555
                    for d in connected_devices:
                        if device_id in d or d in device_id:
                            final_device_id = d
                            self.emit_log(run_id, f"模糊匹配成功: 输入 {device_id} -> 使用 {final_device_id}")
                            break
                    
                    # 如果还是没找到，尝试主动连接
                    if not final_device_id:
                        self.emit_log(run_id, f"设备 {device_id} 未在列表中，尝试执行 adb connect...")
                        try:
                            # 尝试自动连接
                            proc = await asyncio.create_subprocess_exec(
                                'adb', 'connect', device_id,
                                stdout=asyncio.subprocess.PIPE,
                                stderr=asyncio.subprocess.PIPE
                            )
                            stdout, stderr = await proc.communicate()
                            if proc.returncode == 0:
                                self.emit_log(run_id, f"adb connect 结果: {stdout.decode().strip()}")
                                # 连接后刷新列表
                                await asyncio.sleep(1) # 等待连接建立
                                connected_devices = await AndroidDevice.list_devices()
                                # 再次尝试匹配
                                for d in connected_devices:
                                    if device_id in d or d in device_id:
                                        final_device_id = d
                                        break
                        except Exception as conn_err:
                            self.emit_log(run_id, f"adb connect 执行失败: {conn_err}", level='WARNING')

                if not final_device_id:
                    # 如果最终还是没找到匹配的，但用户指定了，尝试直接使用用户输入的（兜底）
                    final_device_id = device_id
                    self.emit_log(run_id, f"未找到匹配设备，将尝试强制使用输入 ID: {final_device_id}", level='WARNING')
            
            else:
                # 用户未指定，自动选择第一个
                if connected_devices:
                    final_device_id = connected_devices[0]
                    self.emit_log(run_id, f"自动选择第一个设备: {final_device_id}")
                else:
                    raise Exception("未找到任何 Android 设备，请先执行 `adb connect <ip>` 连接电视")

            # 创建设备和 Agent
            self.emit_log(run_id, f"正在初始化设备控制: {final_device_id}")
            device = await AndroidDevice.create(final_device_id)
            agent = AndroidAgent(device)
            self.emit_log(run_id, f"设备连接初始化成功")
            
            # 执行每个测试用例
            for idx, item in enumerate(test_data):
                if STOP_EVENTS[run_id].is_set():
                    execution_results.append({
                        'result_id': item['result_id'],
                        'status': 'cancelled',
                        'start_time': timezone.now(),
                        'end_time': timezone.now(),
                    })
                    continue
                
                # === 用例间页面重置 ===
                # 每个用例执行前，按首页键返回到起始页面，确保用例之间相互独立
                if idx > 0:  # 从第二个用例开始执行重置
                    try:
                        self.emit_log(run_id, "===== 用例重置：按首页键返回起始页面 =====")
                        await agent.ai_keyboard_press('Home')
                        await asyncio.sleep(2)  # 等待页面切换完成
                        self.emit_log(run_id, "页面重置完成，开始执行下一个用例")
                    except Exception as reset_err:
                        self.emit_log(run_id, f"页面重置失败（不影响继续执行）: {reset_err}", level='WARNING')
                
                exec_result = await self._run_single_android_case_async(
                    agent, item, run_id
                )
                execution_results.append(exec_result)
                
        except Exception as e:
            self.emit_log(run_id, f"Android 测试执行错误: {e}", level='ERROR')
            # 标记剩余用例为失败
            for item in test_data:
                if not any(r['result_id'] == item['result_id'] for r in execution_results):
                    execution_results.append({
                        'result_id': item['result_id'],
                        'status': 'failed',
                        'error_message': str(e),
                        'start_time': timezone.now(),
                        'end_time': timezone.now(),
                    })
        finally:
            if device:
                await device.disconnect()
        
        return execution_results

    async def _run_single_android_case_async(self, agent, item, run_id):
        """执行单个 Android 测试用例（不访问数据库）"""
        start_time = timezone.now()
        case_id = item['case_id']
        
        self.emit_log(run_id, f"START: Executing Case {case_id}")
        
        # 用于收集执行过程中的数据（用于生成报告）
        execution_trace = {
            'case_id': case_id,
            'start_time': start_time.isoformat(),
            'steps': [],
            'screenshots': []
        }

        try:
            if 'error' in item:
                raise Exception(item['error'])
            
            yaml_data = item['yaml_data']
            if not yaml_data:
                raise Exception("No script data available")
            
            # 获取任务列表
            tasks = yaml_data.get('tasks', []) if isinstance(yaml_data, dict) else []
            
            # 获取 agent 上下文（如果有）
            agent_context = None
            if isinstance(yaml_data, dict) and 'agent' in yaml_data:
                agent_context = yaml_data['agent'].get('aiActContext', '')
            
            # 执行任务
            for task in tasks:
                if STOP_EVENTS[run_id].is_set():
                    break
                
                task_name = task.get('name', 'Unnamed Task')
                self.emit_log(run_id, f"执行任务: {task_name}")
                
                flow = task.get('flow', [])
                for step_idx, step in enumerate(flow):
                    if STOP_EVENTS[run_id].is_set():
                        break
                    
                    step_start = timezone.now()
                    step_result = await self._execute_android_step_with_trace(
                        agent, step, agent_context, run_id, execution_trace
                    )
                    step_end = timezone.now()
                    
                    # 记录步骤执行信息
                    execution_trace['steps'].append({
                        'index': step_idx,
                        'step': step,
                        'start_time': step_start.isoformat(),
                        'end_time': step_end.isoformat(),
                        'duration_ms': (step_end - step_start).total_seconds() * 1000,
                        'result': step_result
                    })
            
            self.emit_log(run_id, f"SUCCESS: Case {case_id} Passed")
            
            # 生成详细报告
            execution_trace['end_time'] = timezone.now().isoformat()
            execution_trace['status'] = 'success'
            report_path = await self._generate_case_report(run_id, case_id, execution_trace)
            
            return {
                'result_id': item['result_id'],
                'status': 'success',
                'start_time': start_time,
                'end_time': timezone.now(),
                'report_path': report_path,
            }

        except Exception as e:
            self.emit_log(run_id, f"ERROR: Case {case_id} Failed: {e}", level='ERROR')
            
            # 生成失败报告
            execution_trace['end_time'] = timezone.now().isoformat()
            execution_trace['status'] = 'failed'
            execution_trace['error'] = str(e)
            report_path = await self._generate_case_report(run_id, case_id, execution_trace)
            
            return {
                'result_id': item['result_id'],
                'status': 'failed',
                'error_message': str(e),
                'start_time': start_time,
                'end_time': timezone.now(),
                'report_path': report_path,
            }
    
    async def _execute_android_step_with_trace(self, agent, step, context, run_id, trace):
        """执行步骤并收集跟踪数据"""
        result = {'success': True}
        
        try:
            # 在执行前截图
            try:
                ctx = await agent.interface.get_context()
                if ctx and ctx.screenshot_base64:
                    trace['screenshots'].append({
                        'timestamp': timezone.now().isoformat(),
                        'type': 'before',
                        'step': str(step)[:50],
                        'image': ctx.screenshot_base64
                    })
            except Exception as e:
                logger.warning(f"截图失败: {e}")
            
            # 执行步骤
            await self._execute_android_step(agent, step, context, run_id)
            
            # 在执行后截图（对于重要操作）
            if isinstance(step, dict) and any(k in step for k in ['ai', 'aiAssert', 'aiKeyboardPress', 'traditionalVisionAssert']):
                await asyncio.sleep(0.5)  # 等待界面稳定
                try:
                    ctx = await agent.interface.get_context()
                    if ctx and ctx.screenshot_base64:
                        trace['screenshots'].append({
                            'timestamp': timezone.now().isoformat(),
                            'type': 'after',
                            'step': str(step)[:50],
                            'image': ctx.screenshot_base64
                        })
                except Exception as e:
                    logger.warning(f"截图失败: {e}")
                    
        except Exception as e:
            result = {'success': False, 'error': str(e)}
            raise
        
        return result
    
    async def _generate_case_report(self, run_id, case_id, trace):
        """为单个用例生成详细的 HTML 报告"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"report_run{run_id}_{case_id}_{timestamp}.html"
            filepath = REPORTS_DIR / filename
            
            # 计算统计数据
            total_steps = len(trace['steps'])
            successful_steps = len([s for s in trace['steps'] if s.get('result', {}).get('success', True)])
            total_screenshots = len(trace['screenshots'])
            
            # 生成步骤 HTML
            steps_html = ""
            for i, step in enumerate(trace['steps']):
                step_status = 'success' if step.get('result', {}).get('success', True) else 'error'
                step_icon = '✅' if step_status == 'success' else '❌'
                step_content = json.dumps(step['step'], ensure_ascii=False, indent=2) if isinstance(step['step'], dict) else str(step['step'])
                
                steps_html += f'''
                <div class="step {step_status}">
                    <div class="step-header">
                        <span class="step-icon">{step_icon}</span>
                        <span class="step-title">Step {i + 1}</span>
                        <span class="step-time">{step.get('duration_ms', 0):.0f}ms</span>
                    </div>
                    <pre class="step-content">{step_content}</pre>
                </div>
                '''
            
            # 生成截图 HTML（时间线形式）
            screenshots_html = ""
            for i, ss in enumerate(trace['screenshots']):
                screenshots_html += f'''
                <div class="screenshot-item">
                    <div class="screenshot-header">
                        <span class="screenshot-time">{ss['timestamp']}</span>
                        <span class="screenshot-type">{ss['type']}</span>
                    </div>
                    <img src="data:image/jpeg;base64,{ss['image']}" alt="Screenshot {i+1}" />
                    <div class="screenshot-caption">{ss['step']}</div>
                </div>
                '''
            
            status_class = 'success' if trace['status'] == 'success' else 'failed'
            error_html = f'<div class="error-message">{trace.get("error", "")}</div>' if trace.get('error') else ''
            
            html_content = f'''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Midscene Report - {case_id}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }}
        .container {{ max-width: 1400px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #238636 0%, #1f6feb 100%); padding: 30px; border-radius: 12px; margin-bottom: 20px; }}
        .header h1 {{ font-size: 1.8em; color: white; margin-bottom: 8px; }}
        .header .meta {{ color: rgba(255,255,255,0.8); font-size: 0.9em; }}
        .status-badge {{ display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; }}
        .status-badge.success {{ background: #238636; color: white; }}
        .status-badge.failed {{ background: #da3633; color: white; }}
        .main-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
        @media (max-width: 1024px) {{ .main-grid {{ grid-template-columns: 1fr; }} }}
        .panel {{ background: #161b22; border: 1px solid #30363d; border-radius: 12px; overflow: hidden; }}
        .panel-header {{ padding: 16px 20px; border-bottom: 1px solid #30363d; font-weight: 600; display: flex; align-items: center; }}
        .panel-header span {{ margin-right: 8px; }}
        .panel-content {{ padding: 16px; max-height: 600px; overflow-y: auto; }}
        .step {{ background: #21262d; border-radius: 8px; padding: 12px; margin-bottom: 12px; border-left: 3px solid #30363d; }}
        .step.success {{ border-left-color: #238636; }}
        .step.error {{ border-left-color: #da3633; }}
        .step-header {{ display: flex; align-items: center; margin-bottom: 8px; }}
        .step-icon {{ margin-right: 8px; }}
        .step-title {{ font-weight: 600; flex: 1; }}
        .step-time {{ color: #8b949e; font-size: 0.85em; }}
        .step-content {{ font-family: monospace; font-size: 0.8em; background: #0d1117; padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }}
        .screenshot-item {{ margin-bottom: 20px; background: #21262d; border-radius: 8px; overflow: hidden; }}
        .screenshot-header {{ padding: 8px 12px; background: #30363d; display: flex; justify-content: space-between; font-size: 0.8em; }}
        .screenshot-item img {{ width: 100%; display: block; }}
        .screenshot-caption {{ padding: 8px 12px; font-size: 0.85em; color: #8b949e; }}
        .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }}
        .stat-card {{ background: #21262d; border-radius: 8px; padding: 16px; text-align: center; }}
        .stat-value {{ font-size: 2em; font-weight: bold; color: #58a6ff; }}
        .stat-label {{ font-size: 0.85em; color: #8b949e; margin-top: 4px; }}
        .error-message {{ background: #da3633; color: white; padding: 12px; border-radius: 8px; margin-bottom: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Midscene Execution Report</h1>
            <div class="meta">
                Case ID: {case_id} | Run ID: {run_id} | 
                <span class="status-badge {status_class}">{trace['status'].upper()}</span>
            </div>
        </div>
        
        {error_html}
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">{total_steps}</div>
                <div class="stat-label">总步骤</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{successful_steps}</div>
                <div class="stat-label">成功步骤</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{total_screenshots}</div>
                <div class="stat-label">截图数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{trace['start_time'][:19]}</div>
                <div class="stat-label">开始时间</div>
            </div>
        </div>
        
        <div class="main-grid">
            <div class="panel">
                <div class="panel-header">
                    <span>📋</span> Execution Steps
                </div>
                <div class="panel-content">
                    {steps_html if steps_html else '<p style="color:#8b949e">No steps recorded</p>'}
                </div>
            </div>
            
            <div class="panel">
                <div class="panel-header">
                    <span>📸</span> Screenshots Timeline
                </div>
                <div class="panel-content">
                    {screenshots_html if screenshots_html else '<p style="color:#8b949e">No screenshots captured</p>'}
                </div>
            </div>
        </div>
    </div>
</body>
</html>
            '''
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html_content)
            
            self.emit_log(run_id, f"报告已生成: {filename}")
            return f"/api/reports/files/{filename}"
            
        except Exception as e:
            logger.error(f"生成报告失败: {e}")
            return None

    async def _execute_android_step(self, agent, step, context, run_id):
        """执行单个 Android 测试步骤"""
        if isinstance(step, dict):
            if 'sleep' in step:
                # 等待
                ms = step['sleep']
                self.emit_log(run_id, f"等待 {ms}ms")
                await asyncio.sleep(ms / 1000)
                
            elif 'ai' in step:
                # AI 操作
                prompt = step['ai']
                if context:
                    prompt = f"{context}\n\n{prompt}"
                prompt = self._inject_runtime_prompt_vars(prompt, run_id)
                self.emit_log(run_id, f"AI 操作: {prompt[:50]}...")
                await agent.ai_action(prompt)
                
            elif 'aiAssert' in step:
                # AI 断言
                assertion = step['aiAssert']
                assertion = self._inject_runtime_prompt_vars(assertion, run_id)

                # 自动分流：对于“找电视剧/封面匹配”等任务，优先走传统视觉断言
                routed = await self._maybe_route_ai_assert_to_traditional_vision(
                    agent=agent,
                    assertion=assertion,
                    run_id=run_id
                )
                if routed:
                    return

                self.emit_log(run_id, f"AI 断言: {assertion[:50]}...")
                # 断言通常是检查当前状态，使用 ai_action 或专门的断言方法
                await agent.ai_assert(assertion)

            elif 'traditionalVisionAssert' in step:
                # 传统视觉断言（不走大模型视觉，降低 token）
                await self._execute_traditional_vision_assert(agent, step['traditionalVisionAssert'], run_id)
                
            elif 'aiKeyboardPress' in step:
                # 按键操作
                key = step['aiKeyboardPress']
                self.emit_log(run_id, f"按键: {key}")
                key_map = {
                    'Enter': 'KEYCODE_ENTER',
                    'Back': 'KEYCODE_BACK',
                    'Home': 'KEYCODE_HOME',
                    'Up': 'KEYCODE_DPAD_UP',
                    'Down': 'KEYCODE_DPAD_DOWN',
                    'Left': 'KEYCODE_DPAD_LEFT',
                    'Right': 'KEYCODE_DPAD_RIGHT',
                }
                key_code = key_map.get(key, f'KEYCODE_{key.upper()}')
                await agent.interface.key_event(key_code)
                
            elif 'runAdbShell' in step:
                # ADB Shell 命令
                cmd = step['runAdbShell']
                self.emit_log(run_id, f"ADB Shell: {cmd}")
                device_id = agent.interface.device_id
                process = await asyncio.create_subprocess_exec(
                    'adb', '-s', device_id, 'shell', cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await process.communicate()
                
            else:
                # 未知步骤，尝试作为 AI 操作执行
                self.emit_log(run_id, f"未知步骤类型: {step}", level='WARNING')

    def _inject_runtime_prompt_vars(self, text, run_id):
        """将运行时识别结果注入到后续 AI prompt 中（纯文本注入，不额外附图）。"""
        if not isinstance(text, str):
            return text

        runtime_ctx = RUN_CONTEXTS.get(run_id, {})
        vision = runtime_ctx.get('last_traditional_vision') or {}
        replacements = {
            "{{last_traditional_vision.best_label}}": str(vision.get("best_label", "")),
            "{{last_traditional_vision.best_score}}": str(vision.get("best_score", "")),
            "{{last_traditional_vision.top_matches}}": json.dumps(vision.get("top_matches", []), ensure_ascii=False),
        }

        out = text
        for key, value in replacements.items():
            out = out.replace(key, value)
        return out

    async def _execute_traditional_vision_assert(self, agent, rule, run_id):
        """
        传统视觉断言。

        YAML 示例：
        - traditionalVisionAssert:
            category: tv_series
            target: 江湖正道
            minScore: 0.78
            topK: 3
        """
        if isinstance(rule, str):
            rule = {"target": rule}
        if not isinstance(rule, dict):
            raise Exception("traditionalVisionAssert 参数格式错误，应为字符串或对象")

        target = (rule.get("target") or "").strip()
        if not target:
            raise Exception("traditionalVisionAssert 缺少 target")

        category = rule.get("category", "tv_series")
        min_score = float(rule.get("minScore", 0.78))
        top_k = int(rule.get("topK", 3))

        self.emit_log(run_id, f"传统视觉断言: target={target}, category={category}, minScore={min_score}")

        ctx = await agent.interface.get_context()
        if not ctx or not ctx.screenshot_base64:
            raise Exception("traditionalVisionAssert 获取截图失败")

        result = self.traditional_vision_matcher.match_base64(
            screenshot_base64=ctx.screenshot_base64,
            target=target,
            category=category,
            min_score=min_score,
            top_k=top_k,
        )

        RUN_CONTEXTS.setdefault(run_id, {})["last_traditional_vision"] = result
        self.emit_log(
            run_id,
            f"传统视觉结果: best={result.get('best_label')} score={result.get('best_score'):.3f} "
            f"matched={result.get('matched')} top={result.get('top_matches')}",
        )

        if not result.get("matched"):
            raise Exception(
                f"传统视觉断言失败: target={target}, best={result.get('best_label')}, "
                f"score={result.get('best_score'):.3f}, minScore={min_score}"
            )

    async def _maybe_route_ai_assert_to_traditional_vision(self, agent, assertion, run_id):
        """根据 aiAssert 文本自动分流到传统视觉断言。"""
        if not self._is_auto_traditional_vision_enabled():
            return False
        if not isinstance(assertion, str):
            return False
        rule = self._build_traditional_vision_rule_from_assertion(assertion)
        if not rule:
            return False

        min_score = self._get_env_float("TRADITIONAL_VISION_MIN_SCORE", 0.78)
        top_k = self._get_env_int("TRADITIONAL_VISION_TOP_K", 3)
        rule["minScore"] = rule.get("minScore", min_score)
        rule["topK"] = rule.get("topK", top_k)
        self.emit_log(
            run_id,
            "aiAssert 自动分流 -> traditionalVisionAssert "
            f"(category={rule.get('category')}, target={rule.get('target')}, "
            f"minScore={rule.get('minScore')}, topK={rule.get('topK')})"
        )
        await self._execute_traditional_vision_assert(
            agent=agent,
            rule=rule,
            run_id=run_id,
        )
        return True

    def _is_auto_traditional_vision_enabled(self):
        return os.getenv("AUTO_TRADITIONAL_VISION_ROUTING", "true").strip().lower() in {"1", "true", "yes", "on"}

    def _is_tv_cover_match_assertion(self, assertion):
        text = assertion.strip()
        # 基于“2026米兰冬奥会EPG”用例抽取的图像识别高频场景词：
        # 海报图/广告图/国旗/队标/角标/logo/默认图/占位图 等。
        intent_keywords = [
            "找到", "查找", "匹配", "识别", "定位", "搜索", "确认是", "判断是", "找出",
            "显示正常", "展示正常", "显示正确", "展示正确", "是否显示", "是否正确", "一致"
        ]
        domain_keywords = [
            "电视剧", "剧集", "封面", "海报", "图片", "图像", "图标", "卡片图",
            "国旗", "队标", "角标", "标识", "logo", "Logo", "LOGO",
            "背景图", "广告图", "默认图", "占位图", "焦点图", "横图", "竖图"
        ]
        has_intent = any(k in text for k in intent_keywords)
        has_domain = any(k in text for k in domain_keywords)
        return has_intent and has_domain

    def _build_traditional_vision_rule_from_assertion(self, assertion):
        """从 aiAssert 文本构造传统视觉规则，无法可靠提取时返回 None。"""
        if not self._is_tv_cover_match_assertion(assertion):
            return None

        text = assertion.strip()
        tv_target = self._extract_tv_series_target(text)
        if tv_target:
            return {"category": "tv_series", "target": tv_target}

        # 冬奥 EPG 高频固定视觉元素，适合走传统图像匹配
        fixed_asset_targets = [
            ("中国国旗", ["中国国旗", "国旗"]),
            ("队标", ["队标"]),
            ("金牌标识", ["金牌标识", "奖牌图标"]),
            ("收费角标", ["收费角标", "收费标识"]),
            ("嘉宾logo", ["嘉宾logo", "嘉宾LOGO", "嘉宾logo图"]),
            ("默认图", ["默认图", "占位图"]),
            ("广告图", ["广告图", "广告图片"]),
            ("海报图", ["海报", "海报图"]),
            ("背景图", ["背景图"]),
            ("焦点图", ["焦点图"]),
        ]
        for target, keywords in fixed_asset_targets:
            if any(k in text for k in keywords):
                return {"category": "ui_assets", "target": target}

        return None

    def _extract_tv_series_target(self, assertion):
        text = assertion.strip()
        patterns = [
            r"[《“\"']([^》”\"']{1,30})[》”\"']",
            r"(?:名为|叫做|是)\s*([A-Za-z0-9\u4e00-\u9fa5·\-_]{1,30})\s*(?:的)?(?:电视剧|剧集|剧)?",
            r"(?:找到|查找|搜索|识别|匹配|定位)\s*([A-Za-z0-9\u4e00-\u9fa5·\-_]{1,30})\s*(?:这部)?(?:电视剧|剧集|剧)?",
        ]
        for pattern in patterns:
            matched = re.search(pattern, text)
            if matched:
                candidate = (matched.group(1) or "").strip(" ,，.。;；:：")
                if candidate:
                    return candidate
        return None

    def _get_env_float(self, key, default):
        raw = os.getenv(key)
        if raw is None:
            return default
        try:
            return float(raw)
        except Exception:
            return default

    def _get_env_int(self, key, default):
        raw = os.getenv(key)
        if raw is None:
            return default
        try:
            return int(raw)
        except Exception:
            return default

    def _run_web_tests(self, run, results, run_id):
        """运行 Web 测试"""
        from midscene import Agent
        from midscene.web import SeleniumWebPage
        
        self.emit_log(run_id, "检测到 Web 测试脚本")
        
        execution_results = []
        
        with SeleniumWebPage.create(headless=False) as page:
            agent = Agent(page)
            
            for result in results:
                if STOP_EVENTS[run_id].is_set():
                    break
                    
                self._run_single_web_case(agent, result, run_id)
                execution_results.append({'result_id': result.id})
                
                # 更新统计
                if result.status == 'success':
                    run.passed_cases += 1
                elif result.status == 'failed':
                    run.failed_cases += 1
                run.save()
        
        # 生成 HTML 报告
        self._generate_html_report(run, execution_results)

    def _run_single_web_case(self, agent, result, run_id):
        """执行单个 Web 测试用例"""
        result.status = 'running'
        result.start_time = timezone.now()
        result.save()
        
        self.emit_log(run_id, f"START: Executing Case {result.test_case.case_id}")

        try:
            script = result.test_case.script
            if not script:
                raise Exception("No generated script found for this test case")

            yaml_content = script.yaml_content
            data = yaml.safe_load(yaml_content)
            
            tasks = data.get('tasks', []) if isinstance(data, dict) else data
            target = data.get('target', None) if isinstance(data, dict) else None

            # 创建新的事件循环
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                loop.run_until_complete(self._execute_web_steps(agent, tasks, target))
            finally:
                loop.close()

            result.status = 'success'
            self.emit_log(run_id, f"SUCCESS: Case {result.test_case.case_id} Passed")

        except Exception as e:
            result.status = 'failed'
            result.error_message = str(e)
            self.emit_log(run_id, f"ERROR: Case {result.test_case.case_id} Failed: {e}", level='ERROR')
        finally:
            result.end_time = timezone.now()
            result.duration = (result.end_time - result.start_time).total_seconds()
            result.save()

    async def _execute_web_steps(self, agent, tasks, target):
        """执行 Web 测试步骤"""
        if target:
            await agent.interface.navigate_to(target)

        for step in tasks:
            if isinstance(step, str):
                await agent.ai_action(step)
            elif isinstance(step, dict):
                prompt = step.get('description') or step.get('action') or str(step)
                await agent.ai_action(prompt)

    def _log_sink(self, run_id, msg):
        """Callback for loguru to push logs to queue"""
        if run_id in LOG_QUEUES:
            LOG_QUEUES[run_id].put(msg)
    
    def emit_log(self, run_id, message, level='INFO'):
        logger.log(level, message)
    
    def _generate_html_report(self, run, results):
        """生成 HTML 报告文件"""
        try:
            from django.utils import timezone
            
            # 准备报告数据
            report_data = {
                'run_id': run.id,
                'status': run.status,
                'start_time': run.start_time.isoformat() if run.start_time else None,
                'end_time': run.end_time.isoformat() if run.end_time else None,
                'duration': (run.end_time - run.start_time).total_seconds() if run.end_time and run.start_time else 0,
                'total_cases': run.total_cases,
                'passed_cases': run.passed_cases,
                'failed_cases': run.failed_cases,
                'results': []
            }
            
            # 收集结果数据
            for result in results:
                result_obj = TestResult.objects.get(id=result['result_id']) if isinstance(result, dict) else result
                report_data['results'].append({
                    'case_id': result_obj.test_case.case_id,
                    'title': result_obj.test_case.title,
                    'status': result_obj.status,
                    'error_message': result_obj.error_message,
                    'duration': result_obj.duration,
                    'start_time': result_obj.start_time.isoformat() if result_obj.start_time else None,
                    'end_time': result_obj.end_time.isoformat() if result_obj.end_time else None,
                })
            
            # 生成 HTML
            html_content = self._render_html_report(report_data)
            
            # 保存文件
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"report_run_{run.id}_{timestamp}.html"
            filepath = REPORTS_DIR / filename
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html_content)
            
            # 更新运行记录的报告路径（如果有该字段）
            logger.info(f"HTML 报告已生成: {filepath}")
            self.emit_log(run.id, f"报告已生成: {filename}")
            
            return str(filepath)
            
        except Exception as e:
            logger.error(f"生成报告失败: {e}")
            return None
    
    def _render_html_report(self, data):
        """渲染 HTML 报告"""
        pass_rate = (data['passed_cases'] / data['total_cases'] * 100) if data['total_cases'] > 0 else 0
        
        results_html = ""
        for r in data['results']:
            status_class = 'success' if r['status'] == 'success' else 'failure' if r['status'] == 'failed' else 'pending'
            status_text = '✅ 通过' if r['status'] == 'success' else '❌ 失败' if r['status'] == 'failed' else '⏳ 等待中'
            error_html = f'<div class="error-message">{r["error_message"]}</div>' if r.get('error_message') else ''
            
            results_html += f'''
            <div class="result-card {status_class}">
                <div class="result-header">
                    <span class="case-id">{r['case_id']}</span>
                    <span class="status-badge {status_class}">{status_text}</span>
                </div>
                <div class="result-title">{r['title']}</div>
                <div class="result-meta">耗时: {r['duration']:.1f}s</div>
                {error_html}
            </div>
            '''
        
        return f'''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Midscene 测试报告 - 运行 #{data['run_id']}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; line-height: 1.6; }}
        .container {{ max-width: 1200px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 12px; margin-bottom: 24px; }}
        .header h1 {{ font-size: 2em; margin-bottom: 8px; }}
        .header .meta {{ opacity: 0.9; font-size: 0.9em; }}
        .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }}
        .stat-card {{ background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
        .stat-card .label {{ color: #666; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; }}
        .stat-card .value {{ font-size: 2.5em; font-weight: bold; margin-top: 8px; }}
        .stat-card.pass .value {{ color: #10b981; }}
        .stat-card.fail .value {{ color: #ef4444; }}
        .stat-card.total .value {{ color: #6366f1; }}
        .results {{ background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; }}
        .results-header {{ padding: 20px 24px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 1.1em; }}
        .result-card {{ padding: 20px 24px; border-bottom: 1px solid #f3f4f6; }}
        .result-card:last-child {{ border-bottom: none; }}
        .result-card.success {{ border-left: 4px solid #10b981; }}
        .result-card.failure {{ border-left: 4px solid #ef4444; }}
        .result-card.pending {{ border-left: 4px solid #9ca3af; }}
        .result-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }}
        .case-id {{ font-family: monospace; font-weight: 600; color: #6366f1; }}
        .status-badge {{ padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 500; }}
        .status-badge.success {{ background: #d1fae5; color: #065f46; }}
        .status-badge.failure {{ background: #fee2e2; color: #991b1b; }}
        .status-badge.pending {{ background: #f3f4f6; color: #6b7280; }}
        .result-title {{ font-size: 1em; color: #374151; }}
        .result-meta {{ font-size: 0.85em; color: #9ca3af; margin-top: 4px; }}
        .error-message {{ margin-top: 12px; padding: 12px; background: #fef2f2; border-radius: 6px; color: #991b1b; font-size: 0.9em; }}
        .footer {{ text-align: center; padding: 24px; color: #9ca3af; font-size: 0.85em; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Midscene 测试报告</h1>
            <div class="meta">
                运行 ID: #{data['run_id']} | 
                状态: {data['status']} | 
                开始时间: {data['start_time'] or '-'} | 
                耗时: {data['duration']:.1f}s
            </div>
        </div>
        
        <div class="stats">
            <div class="stat-card total">
                <div class="label">总用例数</div>
                <div class="value">{data['total_cases']}</div>
            </div>
            <div class="stat-card pass">
                <div class="label">通过</div>
                <div class="value">{data['passed_cases']}</div>
            </div>
            <div class="stat-card fail">
                <div class="label">失败</div>
                <div class="value">{data['failed_cases']}</div>
            </div>
            <div class="stat-card">
                <div class="label">通过率</div>
                <div class="value">{pass_rate:.1f}%</div>
            </div>
        </div>
        
        <div class="results">
            <div class="results-header">📋 测试结果详情</div>
            {results_html}
        </div>
        
        <div class="footer">
            Generated by Midscene AI Workflow Platform | {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        </div>
    </div>
</body>
</html>
        '''
