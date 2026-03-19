from django.shortcuts import render
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
import pandas as pd
from .models import TestCase, GeneratedScript, TestRun, TestResult
from .serializers import TestCaseSerializer, GeneratedScriptSerializer, TestRunSerializer, TestResultSerializer
from .services.ai_service import AIService
from .services.test_runner import TestRunnerService, LOG_QUEUES, STOP_EVENTS
import json
import time
import queue

# Excel 列名映射（支持中英文）
COLUMN_MAPPINGS = {
    'case_id': ['用例编号', 'ID', 'Case ID', 'CaseID', 'case_id', '编号', 'TestCase ID'],
    'title': ['测试模块', 'Title', '标题', '用例标题', '模块', 'Module', 'Test Title'],
    'description': ['测试描述', 'Description', '描述', '用例描述', 'Desc'],
    'preconditions': ['前置条件', 'Preconditions', '初始条件', 'Prerequisites', '起始条件'],
    'steps': ['测试步骤', 'Steps', '操作步骤', 'Test Steps', '步骤'],
    'expected_result': ['预期结果', 'Expected Result', '期望结果', 'Expected', '预期'],
    'priority': ['优先级', 'Priority', '级别'],
}

def find_column(df_columns, field_name):
    """智能匹配列名"""
    possible_names = COLUMN_MAPPINGS.get(field_name, [field_name])
    for name in possible_names:
        for col in df_columns:
            if name.lower() in col.lower() or col.lower() in name.lower():
                return col
    return None

@api_view(['POST'])
def upload_excel(request):
    """
    Upload Excel file and parse into Test Cases.
    支持中英文列名智能映射。
    """
    if 'file' not in request.FILES:
        return Response({"error": "No file uploaded"}, status=status.HTTP_400_BAD_REQUEST)
    
    file = request.FILES['file']
    try:
        # Read Excel using pandas
        df = pd.read_excel(file)
        columns = df.columns.tolist()
        
        print(f"[Upload] Excel 列名: {columns}")
        
        # 智能匹配列名
        col_map = {}
        for field in ['case_id', 'title', 'description', 'preconditions', 'steps', 'expected_result', 'priority']:
            matched = find_column(columns, field)
            col_map[field] = matched
            print(f"[Upload] {field} -> {matched}")
        
        cases = []
        for index, row in df.iterrows():
            # 使用匹配到的列名读取数据
            case_data = {
                'case_id': str(row[col_map['case_id']]) if col_map['case_id'] else f'TC-{index}',
                'title': str(row[col_map['title']]) if col_map['title'] else f'Test Case {index}',
                'description': str(row[col_map['description']]) if col_map['description'] else '',
                'preconditions': str(row[col_map['preconditions']]) if col_map['preconditions'] else '',
                'steps': str(row[col_map['steps']]) if col_map['steps'] else '',
                'expected_result': str(row[col_map['expected_result']]) if col_map['expected_result'] else '',
            }
            
            # 清理 nan 值
            for key in case_data:
                if case_data[key] == 'nan' or pd.isna(case_data.get(key)):
                    case_data[key] = ''
            
            print(f"[Upload] 解析用例: {case_data['case_id']} - {case_data['title'][:30]}...")
            
            # Update or create
            tc, created = TestCase.objects.update_or_create(
                case_id=case_data['case_id'],
                defaults=case_data
            )
            cases.append(tc)
            
        serializer = TestCaseSerializer(cases, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
def generate_script(request):
    """
    Generate Midscene YAML for specific test cases using AI.
    Supports few-shot learning with example files.
    """
    # Handle both JSON and FormData
    if request.content_type and 'multipart/form-data' in request.content_type:
        case_ids_str = request.POST.get('case_ids', '[]')
        case_ids = json.loads(case_ids_str)
        example_excel = request.FILES.get('example_excel')
        example_yaml = request.FILES.get('example_yaml')
    else:
        case_ids = request.data.get('case_ids', [])
        example_excel = None
        example_yaml = None
    
    if not case_ids:
        return Response({"error": "No case_ids provided"}, status=status.HTTP_400_BAD_REQUEST)
    
    # Process example files for few-shot learning
    example_content = None
    if example_excel and example_yaml:
        try:
            # Read example Excel
            example_df = pd.read_excel(example_excel)
            example_excel_text = example_df.to_string()
            
            # Read example YAML
            example_yaml_text = example_yaml.read().decode('utf-8')
            
            example_content = {
                'excel': example_excel_text,
                'yaml': example_yaml_text
            }
        except Exception as e:
            print(f"Error processing example files: {e}")
            # Continue without examples if processing fails
    
    ai_service = AIService()
    generated_scripts = []
    
    test_cases = TestCase.objects.filter(case_id__in=case_ids)
    
    for tc in test_cases:
        print(f"[Generate] 正在为用例 {tc.case_id} 生成脚本...")
        
        # Convert model instance to dict（包含 case_id）
        data = {
            'case_id': tc.case_id,  # 添加用例编号
            'title': tc.title,
            'description': tc.description,
            'preconditions': tc.preconditions,
            'steps': tc.steps,
            'expected_result': tc.expected_result
        }
        
        yaml_content = ai_service.generate_midscene_script(data, example_content=example_content)
        print(f"[Generate] 用例 {tc.case_id} 脚本生成{'成功' if yaml_content else '失败'}")
        
        if yaml_content:
            script, created = GeneratedScript.objects.update_or_create(
                test_case=tc,
                defaults={
                    'yaml_content': yaml_content,
                    'status': 'completed'
                }
            )
            generated_scripts.append(script)
        else:
            # Handle failure
            GeneratedScript.objects.update_or_create(
                test_case=tc,
                defaults={'status': 'failed', 'error_message': 'AI Generation Failed'}
            )

    serializer = GeneratedScriptSerializer(generated_scripts, many=True)
    return Response(serializer.data)

@api_view(['POST'])
def start_execution(request):
    """
    Start a test run.
    """
    case_ids = request.data.get('case_ids') # Optional list of case IDs
    device_id = request.data.get('device_id') # Optional Android device ID (e.g., "192.168.1.102:5555")
    
    # Create Test Run record
    run = TestRun.objects.create(status='pending')
    
    if case_ids:
        cases = TestCase.objects.filter(case_id__in=case_ids)
    else:
        cases = TestCase.objects.all() # Or filter by active/ready

    # Create Test Results as placeholders
    for tc in cases:
        TestResult.objects.create(run=run, test_case=tc, status='pending')
        
    run.total_cases = cases.count()
    run.save()
    
    # Start background thread
    runner = TestRunnerService()
    runner.execute_run(
        run.id, 
        case_ids=[c.case_id for c in cases] if case_ids else None,
        device_id=device_id
    )
    
    return Response({
        "run_id": run.id,
        "status": "started", 
        "message": "Execution started in background"
    })

@api_view(['POST'])
def stop_execution(request):
    run_id = request.data.get('run_id')
    if run_id in STOP_EVENTS:
        STOP_EVENTS[run_id].set()
        return Response({"message": "Stop signal sent"})
    return Response({"error": "Run ID not found or not running"}, status=404)

from django.http import StreamingHttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

def event_stream(run_id):
    """Generator for SSE"""
    if run_id not in LOG_QUEUES:
        # 队列不存在，可能是运行已结束或无效ID
        # 检查数据库状态
        try:
            run = TestRun.objects.get(id=run_id)
            yield f"data: {json.dumps({'status': run.status, 'message': f'Run already {run.status}'})}\n\n"
        except TestRun.DoesNotExist:
            yield f"data: {json.dumps({'error': 'Run not found'})}\n\n"
        return

    q = LOG_QUEUES[run_id]
    heartbeat_count = 0
    
    while True:
        try:
            # 尝试从队列获取日志，超时2秒
            msg = q.get(timeout=2)
            yield f"data: {json.dumps({'message': str(msg)})}\n\n"
            heartbeat_count = 0  # 重置心跳计数
        except queue.Empty:
            # 队列为空，检查执行是否结束
            try:
                run = TestRun.objects.get(id=run_id)
                if run.status in ['completed', 'stopped', 'failed']:
                    # 执行结束，发送最终状态
                    yield f"data: {json.dumps({'status': run.status, 'final': True})}\n\n"
                    # 清理队列
                    if run_id in LOG_QUEUES:
                        del LOG_QUEUES[run_id]
                    break
                else:
                    # 仍在运行，发送心跳保持连接
                    heartbeat_count += 1
                    if heartbeat_count % 5 == 0:  # 每10秒发送一次心跳
                        yield f"data: {json.dumps({'heartbeat': True, 'status': run.status})}\n\n"
            except TestRun.DoesNotExist:
                yield f"data: {json.dumps({'error': 'Run deleted'})}\n\n"
                break
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            break

# 不使用 @api_view 装饰器，改用原生 Django 视图以支持 SSE
@csrf_exempt
def execution_stream(request):
    """SSE 端点 - 实时日志流"""
    run_id = request.GET.get('run_id')
    if not run_id:
        return JsonResponse({"error": "run_id required"}, status=400)
    
    try:
        run_id = int(run_id)
    except ValueError:
        return JsonResponse({"error": "Invalid run_id"}, status=400)

    response = StreamingHttpResponse(
        event_stream(run_id), 
        content_type='text/event-stream'
    )
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # 禁用 nginx 缓冲
    return response

@api_view(['GET'])
def report_list(request):
    """
    Get list of test runs.
    """
    runs = TestRun.objects.all().order_by('-start_time')
    serializer = TestRunSerializer(runs, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def report_detail(request, pk):
    """
    Get detailed report for a run.
    """
    try:
        run = TestRun.objects.get(pk=pk)
    except TestRun.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    
    serializer = TestRunSerializer(run)
    return Response(serializer.data)

@api_view(['GET'])
def report_files(request):
    """
    获取报告文件列表
    """
    from pathlib import Path
    from django.conf import settings
    
    reports_dir = Path(settings.BASE_DIR) / 'reports'
    
    if not reports_dir.exists():
        return Response([])
    
    files = []
    for f in sorted(reports_dir.glob('*.html'), key=lambda x: x.stat().st_mtime, reverse=True):
        files.append({
            'name': f.name,
            'path': f'/api/reports/files/{f.name}',
            'size': f.stat().st_size,
            'modified': f.stat().st_mtime,
        })
    
    return Response(files[:50])  # 最多返回50个


from django.http import FileResponse

def serve_report_file(request, filename):
    """
    提供报告文件下载/查看
    """
    from pathlib import Path
    from django.conf import settings
    
    reports_dir = Path(settings.BASE_DIR) / 'reports'
    file_path = reports_dir / filename
    
    # 安全检查：防止路径遍历攻击
    try:
        file_path.resolve().relative_to(reports_dir.resolve())
    except ValueError:
        return JsonResponse({'error': 'Invalid path'}, status=403)
    
    if not file_path.exists():
        return JsonResponse({'error': 'File not found'}, status=404)
    
    return FileResponse(open(file_path, 'rb'), content_type='text/html')


@api_view(['GET'])
def dashboard_stats(request):
    """
    Get summary stats for dashboard.
    """
    total_runs = TestRun.objects.count()
    if total_runs == 0:
         return Response({
            'total_runs': 0,
            'pass_rate': 0,
            'defects': 0,
            'avg_duration': 0
         })
         
    failed_runs = TestRun.objects.filter(status='failed').count() # or check failed cases
    # Calculating pass rate based on total cases across all runs
    total_cases_all = 0
    passed_cases_all = 0
    failed_cases_all = 0
    
    for run in TestRun.objects.all():
        total_cases_all += run.total_cases
        passed_cases_all += run.passed_cases
        failed_cases_all += run.failed_cases
        
    pass_rate = (passed_cases_all / total_cases_all * 100) if total_cases_all > 0 else 0
    
    return Response({
        'total_runs': total_runs,
        'pass_rate': round(pass_rate, 1),
        'defects': failed_cases_all,
        'avg_duration': 'N/A' # heavy calc omitted
    })

@api_view(['PUT'])
def update_script(request, case_id):
    """
    更新测试用例的脚本内容
    """
    try:
        test_case = TestCase.objects.get(case_id=case_id)
    except TestCase.DoesNotExist:
        return Response({"error": "Test case not found"}, status=404)
    
    yaml_content = request.data.get('yaml_content')
    if not yaml_content:
        return Response({"error": "yaml_content is required"}, status=400)
    
    # 更新或创建脚本
    script, created = GeneratedScript.objects.update_or_create(
        test_case=test_case,
        defaults={
            'yaml_content': yaml_content,
            'status': 'completed'
        }
    )
    
    serializer = GeneratedScriptSerializer(script)
    return Response(serializer.data)


@api_view(['GET'])
def get_script(request, case_id):
    """
    获取测试用例的脚本内容
    """
    try:
        test_case = TestCase.objects.get(case_id=case_id)
        script = test_case.script
        serializer = GeneratedScriptSerializer(script)
        return Response(serializer.data)
    except TestCase.DoesNotExist:
        return Response({"error": "Test case not found"}, status=404)
    except GeneratedScript.DoesNotExist:
        return Response({"error": "Script not found"}, status=404)


@api_view(['POST'])
def import_local_scripts(request):
    """
    Import local YAML scripts directly as Test Cases.
    """
    scripts_data = request.data.get('scripts', [])
    if not scripts_data:
        return Response({"error": "No scripts provided"}, status=400)
    
    imported_cases = []
    
    for item in scripts_data:
        file_name = item.get('file_name', 'Unknown')
        content = item.get('content', '')
        
        # Create a TestCase for this local script
        # specific ID prefix to distinguish
        case_id = f"LOCAL-{int(time.time())}-{file_name}"
        
        tc, created = TestCase.objects.update_or_create(
            case_id=case_id,
            defaults={
                'title': file_name,
                'description': 'Imported from local file',
                'steps': 'N/A (Local Script)',
                'expected_result': 'N/A'
            }
        )
        
        # Create GeneratedScript
        GeneratedScript.objects.update_or_create(
            test_case=tc,
            defaults={
                'yaml_content': content,
                'status': 'completed'
            }
        )
        
        imported_cases.append(tc)
        
    serializer = TestCaseSerializer(imported_cases, many=True)
    return Response(serializer.data)
