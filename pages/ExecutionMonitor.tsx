import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogEntry, TestCase, ExecutionStats } from '../types';

interface ExecutionMonitorProps {
  testCases: TestCase[];
  deviceId?: string;
  onComplete: (runId: number) => void;
  autoStart?: boolean;  // 是否自动启动，默认 false
}

const ExecutionMonitor: React.FC<ExecutionMonitorProps> = ({ 
  testCases, 
  deviceId, 
  onComplete,
  autoStart = false  // 默认不自动启动
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<ExecutionStats>({
    total: testCases.length,
    running: 0,
    completed: 0,
    failed: 0,
    passed: 0
  });
  const [runId, setRunId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);  // 是否已经启动过
  const [runningCases, setRunningCases] = useState<TestCase[]>([]);
  const [pendingCases, setPendingCases] = useState<TestCase[]>(testCases);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  // 计算进度
  const progress = stats.total > 0 ? ((stats.completed + stats.failed) / stats.total) * 100 : 0;

  // 添加日志
  const addLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      message
    }]);
  }, []);

  // 重置状态
  const resetState = useCallback(() => {
    setLogs([]);
    setStats({ total: testCases.length, running: 0, completed: 0, failed: 0, passed: 0 });
    setRunId(null);
    setPendingCases(testCases);
    setRunningCases([]);
    setIsRunning(false);
    reconnectAttempts.current = 0;
    
    // 关闭现有 SSE 连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, [testCases]);

  // 启动执行
  const startExecution = useCallback(async () => {
    if (testCases.length === 0) {
      addLog('没有测试用例可执行', 'error');
      return;
    }

    // 如果已经在运行，不重复启动
    if (isRunning) {
      addLog('测试已在运行中', 'warn');
      return;
    }

    setIsRunning(true);
    setHasStarted(true);
    addLog('正在启动测试执行...', 'info');

    try {
      const caseIds = testCases.map(tc => tc.id);

      const requestBody: { case_ids: string[], device_id?: string } = { case_ids: caseIds };
      if (deviceId) {
        requestBody.device_id = deviceId;
        addLog(`使用设备: ${deviceId}`, 'info');
      }

      const response = await fetch('/api/execution/start/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '启动执行失败');
      }

      const data = await response.json();
      setRunId(data.run_id);
      addLog(`执行已启动，运行 ID: ${data.run_id}`, 'success');

      // 连接 SSE 日志流
      connectLogStream(data.run_id);

    } catch (err: any) {
      addLog(`启动失败: ${err.message}`, 'error');
      setIsRunning(false);
    }
  }, [testCases, deviceId, isRunning, addLog]);

  // 连接日志流 (SSE)
  const connectLogStream = useCallback((streamRunId: number) => {
    addLog('正在连接实时日志流...', 'info');

    // 关闭现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/execution/stream/?run_id=${streamRunId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      addLog('日志流连接成功', 'success');
      reconnectAttempts.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 忽略心跳消息
        if (data.heartbeat) {
          return;
        }

        if (data.message) {
          // 解析日志级别
          let level: LogEntry['level'] = 'info';
          const msg = data.message.toString();

          if (msg.includes('ERROR') || msg.includes('Failed') || msg.includes('失败')) {
            level = 'error';
          } else if (msg.includes('SUCCESS') || msg.includes('Passed') || msg.includes('成功')) {
            level = 'success';
          } else if (msg.includes('WARN') || msg.includes('警告')) {
            level = 'warn';
          }

          addLog(msg, level);

          // 根据日志更新统计
          if (msg.includes('START:')) {
            // 开始执行某个用例
            const caseId = msg.match(/Case\s+(\S+)/)?.[1];
            if (caseId) {
              setRunningCases(prev => {
                const tc = testCases.find(t => t.id === caseId);
                if (tc && !prev.find(p => p.id === caseId)) {
                  return [...prev, { ...tc, status: 'running' }];
                }
                return prev;
              });
              setPendingCases(prev => prev.filter(p => p.id !== caseId));
              setStats(prev => ({ ...prev, running: prev.running + 1 }));
            }
          } else if (msg.includes('SUCCESS:')) {
            // 用例通过
            const caseId = msg.match(/Case\s+(\S+)/)?.[1];
            if (caseId) {
              setRunningCases(prev => prev.filter(p => p.id !== caseId));
              setStats(prev => ({
                ...prev,
                running: Math.max(0, prev.running - 1),
                completed: prev.completed + 1,
                passed: prev.passed + 1
              }));
            }
          } else if (msg.includes('ERROR:') || msg.includes('Failed:')) {
            // 用例失败
            const caseId = msg.match(/Case\s+(\S+)/)?.[1];
            if (caseId) {
              setRunningCases(prev => prev.filter(p => p.id !== caseId));
              setStats(prev => ({
                ...prev,
                running: Math.max(0, prev.running - 1),
                failed: prev.failed + 1
              }));
            }
          }
        }

        if (data.status && data.final) {
          // 执行完成（final 标志表示这是最终状态）
          addLog(`执行完成，最终状态: ${data.status}`, data.status === 'completed' ? 'success' : 'warn');
          setIsRunning(false);
          eventSource.close();
          eventSourceRef.current = null;

          // 延迟通知完成（给用户看到最终日志的时间）
          if (streamRunId) {
            setTimeout(() => {
              onComplete(streamRunId);
            }, 2000);
          }
        }

        if (data.error) {
          addLog(`错误: ${data.error}`, 'error');
          if (data.error === 'Run not found' || data.error === 'Run deleted') {
            setIsRunning(false);
            eventSource.close();
            eventSourceRef.current = null;
          }
        }
      } catch (e) {
        console.error('解析日志失败:', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE 连接错误:', err);
      
      // 尝试重连
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current += 1;
        addLog(`日志流连接断开，正在重试 (${reconnectAttempts.current}/${maxReconnectAttempts})...`, 'warn');
        
        eventSource.close();
        setTimeout(() => {
          if (isRunning) {
            connectLogStream(streamRunId);
          }
        }, 2000);
      } else {
        addLog('日志流连接失败，请刷新页面重试', 'error');
        eventSource.close();
        eventSourceRef.current = null;
      }
    };
  }, [addLog, testCases, onComplete, isRunning]);

  // 停止执行
  const stopExecution = useCallback(async () => {
    if (!runId) {
      addLog('没有正在运行的任务', 'warn');
      return;
    }

    addLog('正在发送停止信号...', 'info');

    try {
      const response = await fetch('/api/execution/stop/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId })
      });

      if (response.ok) {
        addLog('已发送停止信号，等待任务停止...', 'warn');
      } else {
        const errorData = await response.json().catch(() => ({}));
        addLog(`停止失败: ${errorData.error || '未知错误'}`, 'error');
      }
    } catch (err: any) {
      addLog(`停止失败: ${err.message}`, 'error');
    }
  }, [runId, addLog]);

  // 重新运行
  const handleRerun = useCallback(() => {
    resetState();
    // 延迟一点启动，确保状态已重置
    setTimeout(() => {
      startExecution();
    }, 100);
  }, [resetState, startExecution]);

  // 组件挂载/卸载处理
  useEffect(() => {
    // 只有在 autoStart 为 true 且未启动过时才自动启动
    if (autoStart && testCases.length > 0 && !hasStarted) {
      startExecution();
    }

    // 清理
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [autoStart, testCases.length, hasStarted, startExecution]);

  // 自动滚动日志
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">批量执行监控</h1>
          <p className="text-sm text-gray-500 mt-1">
            {runId ? `运行 ID: ${runId}` : '准备启动测试执行'}
          </p>
        </div>
        <div className="flex space-x-3">
          {/* 开始执行按钮 - 未启动时显示 */}
          {!hasStarted && (
            <button
              onClick={startExecution}
              className="px-4 py-2 rounded-md text-sm font-medium shadow-sm flex items-center bg-green-600 text-white hover:bg-green-700"
            >
              <span className="material-icons-round mr-2 text-base">play_arrow</span>
              开始执行
            </button>
          )}
          
          {/* 停止执行按钮 */}
          <button
            onClick={stopExecution}
            disabled={!isRunning}
            className={`px-4 py-2 border rounded-md text-sm font-medium shadow-sm flex items-center ${isRunning
              ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
              : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              }`}
          >
            <span className="material-icons-round mr-2 text-base">stop_circle</span>
            停止执行
          </button>
          
          {/* 重新运行按钮 */}
          <button
            onClick={handleRerun}
            disabled={isRunning}
            className={`px-4 py-2 rounded-md text-sm font-medium shadow-sm flex items-center ${isRunning
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary text-white hover:bg-blue-600'
              }`}
          >
            <span className="material-icons-round mr-2 text-base">refresh</span>
            重新运行
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex justify-between text-sm font-medium text-gray-600 mb-2">
          <span>总体执行进度</span>
          <span className="text-primary">{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: '总任务数', val: stats.total.toString(), icon: 'list_alt', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '运行中', val: stats.running.toString(), icon: 'sync', color: 'text-indigo-600', bg: 'bg-indigo-50', iconClass: isRunning ? 'animate-spin' : '' },
          { label: '已通过', val: stats.passed.toString(), icon: 'check_circle', color: 'text-green-600', bg: 'bg-green-50' },
          { label: '失败', val: stats.failed.toString(), icon: 'error_outline', color: 'text-red-600', bg: 'bg-red-50' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex items-center">
            <div className={`p-3 rounded-lg ${stat.bg} ${stat.color} mr-4`}>
              <span className={`material-icons-round ${stat.iconClass || ''}`}>{stat.icon}</span>
            </div>
            <div>
              <div className="text-sm text-gray-500">{stat.label}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{stat.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Terminal */}
        <div className="lg:col-span-2 bg-[#1E1E1E] rounded-lg shadow-lg flex flex-col overflow-hidden border border-gray-800">
          <div className="bg-[#252526] px-4 py-2 flex items-center justify-between border-b border-[#333]">
            <div className="flex items-center space-x-2">
              <span className="material-icons-round text-gray-400 text-sm">terminal</span>
              <span className="text-gray-300 text-sm font-mono">midscene-run output</span>
            </div>
            <div className="flex space-x-1.5">
              <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
            </div>
          </div>
          <div className="flex-1 p-4 font-mono text-xs md:text-sm overflow-y-auto terminal-scroll text-gray-300 space-y-1">
            {logs.length === 0 && !hasStarted && (
              <div className="text-gray-500">
                <p>点击"开始执行"按钮启动测试...</p>
                <p className="mt-2 text-gray-600">已选择 {testCases.length} 个测试用例</p>
              </div>
            )}
            {logs.length === 0 && hasStarted && (
              <div className="text-gray-500">正在初始化...</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="flex">
                {log.level === 'info' && <span className="text-blue-400 mr-2">ℹ</span>}
                {log.level === 'success' && <span className="text-green-400 mr-2">✔</span>}
                {log.level === 'error' && <span className="text-red-400 mr-2">✖</span>}
                {log.level === 'warn' && <span className="text-yellow-400 mr-2">⚠</span>}

                <span className="text-gray-500 mr-2">[{log.timestamp}]</span>
                <span className={log.level === 'error' ? 'text-red-300' : ''}>{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Queue */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-gray-50">
            <h3 className="font-medium text-gray-700">测试队列</h3>
            <span className="text-xs text-gray-500">{pendingCases.length} 个等待中</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ul className="divide-y divide-gray-100">
              {runningCases.length === 0 && pendingCases.length === 0 && (
                <li className="p-4 text-center text-gray-500 text-sm">
                  {isRunning ? '初始化中...' : '执行完成'}
                </li>
              )}

              {/* 运行中的用例 */}
              {runningCases.map((t) => (
                <li key={t.id} className="p-4 bg-blue-50/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-800">{t.id}</span>
                    <span className="flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      <span className="material-icons-round text-xs mr-1 animate-spin">sync</span>
                      运行中
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{t.name}</p>
                </li>
              ))}

              {/* 等待中的用例 */}
              {pendingCases.slice(0, 5).map((t) => (
                <li key={t.id} className="p-4 hover:bg-gray-50 transition-colors opacity-60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{t.id}</span>
                    <span className="flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                      <span className="material-icons-round text-xs mr-1">hourglass_empty</span>
                      等待中
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{t.name}</p>
                </li>
              ))}

              {pendingCases.length > 5 && (
                <li className="p-4 text-center text-gray-400 text-xs">
                  还有 {pendingCases.length - 5} 个用例等待执行...
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutionMonitor;
