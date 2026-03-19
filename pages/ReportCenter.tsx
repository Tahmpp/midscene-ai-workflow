import React, { useState, useEffect } from 'react';
import { TestResult } from '../types';

interface ReportCenterProps {
  runId: number | null;
  onRestart: () => void;
}

interface ReportData {
  id: number;
  status: string;
  start_time: string;
  end_time: string | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  results: TestResultData[];
}

interface TestResultData {
  id: number;
  test_case: {
    case_id: string;
    title: string;
    description: string;
  };
  status: string;
  start_time: string | null;
  end_time: string | null;
  duration: number;
  error_message: string | null;
  screenshot_path: string | null;
  log_content: string;
  report_path: string | null;  // Midscene 原生报告路径
}

const ReportCenter: React.FC<ReportCenterProps> = ({ runId, onRestart }) => {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  // 移除顶部的报告文件列表，报告现在显示在每个用例的详情面板中

  // 加载报告数据
  useEffect(() => {
    if (runId) {
      fetchReport(runId);
    } else {
      // 如果没有 runId，尝试获取最新的报告
      fetchLatestReport();
    }
  }, [runId]);

  const fetchReport = async (id: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/reports/${id}/`);
      if (!response.ok) {
        throw new Error('获取报告失败');
      }
      const data = await response.json();
      setReport(data);

      // 默认选中第一个结果
      if (data.results && data.results.length > 0) {
        setSelectedResultId(data.results[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLatestReport = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/reports/');
      if (!response.ok) {
        throw new Error('获取报告列表失败');
      }
      const reports = await response.json();

      if (reports.length > 0) {
        // 获取最新报告的详情
        await fetchReport(reports[0].id);
      } else {
        setError('暂无测试报告');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 计算统计数据
  const stats = report ? {
    total: report.total_cases,
    passed: report.passed_cases,
    failed: report.failed_cases,
    passRate: report.total_cases > 0
      ? ((report.passed_cases / report.total_cases) * 100).toFixed(1)
      : '0'
  } : { total: 0, passed: 0, failed: 0, passRate: '0' };

  // 过滤结果
  const filteredResults = report?.results?.filter(r => {
    const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
    const matchesSearch = searchTerm === '' ||
      r.test_case.case_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.test_case.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  }) || [];

  // 选中的结果详情
  const selectedResult = report?.results?.find(r => r.id === selectedResultId);

  // 格式化时间
  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN');
  };

  // 格式化耗时
  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(0);
    return `${mins}m ${secs}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="material-icons-round text-4xl text-primary animate-spin">sync</span>
          <p className="text-gray-500 mt-4">加载报告中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="material-icons-round text-4xl text-gray-400">inbox</span>
          <p className="text-gray-500 mt-4">{error}</p>
          <button
            onClick={onRestart}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-md text-sm"
          >
            运行新测试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">测试报告中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            {report ? `运行 ID: ${report.id} | ${formatTime(report.start_time)}` : 'Midscene AI 驱动的自动化测试结果'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => runId ? fetchReport(runId) : fetchLatestReport()}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition-all shadow-sm flex items-center"
          >
            <span className="material-icons-round text-base mr-2">refresh</span>
            刷新
          </button>
          <button
            onClick={onRestart}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded hover:bg-blue-600 transition-all shadow-sm flex items-center"
          >
            <span className="material-icons-round text-base mr-2">play_arrow</span>
            运行新测试
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: '总用例数', val: stats.total.toString(), icon: 'analytics', color: 'text-primary', bg: 'bg-blue-50' },
          { label: '通过率', val: `${stats.passRate}%`, icon: 'check_circle', color: 'text-green-600', bg: 'bg-green-50' },
          { label: '通过', val: stats.passed.toString(), icon: 'thumb_up', color: 'text-green-600', bg: 'bg-green-50' },
          { label: '失败', val: stats.failed.toString(), icon: 'bug_report', color: 'text-red-600', bg: 'bg-red-50' },
        ].map((card, i) => (
          <div key={i} className="bg-white p-5 rounded shadow-sm border border-gray-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">{card.label}</p>
              <p className={`text-2xl font-bold ${card.color} mt-1`}>{card.val}</p>
            </div>
            <div className={`w-10 h-10 rounded-full ${card.bg} flex items-center justify-center ${card.color}`}>
              <span className="material-icons-round">{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <span className="material-icons-round absolute left-3 top-2.5 text-gray-400 text-lg">search</span>
          <input
            className="pl-10 pr-4 py-2 text-sm w-full bg-white border border-gray-300 rounded-md focus:ring-1 focus:ring-primary outline-none"
            placeholder="按测试用例 ID 或名称筛选..."
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center space-x-2">
          <select
            className="pl-3 pr-8 py-2 text-sm bg-white border border-gray-300 rounded-md text-gray-700 outline-none"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">所有状态</option>
            <option value="success">通过</option>
            <option value="failed">失败</option>
            <option value="pending">等待中</option>
          </select>
          <button
            onClick={() => runId ? fetchReport(runId) : fetchLatestReport()}
            className="p-2 text-gray-500 hover:text-primary bg-gray-50 rounded-md border border-transparent hover:border-gray-200 transition-all"
          >
            <span className="material-icons-round">refresh</span>
          </button>
        </div>
      </div>

      {/* Main Table + Details Layout */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col lg:flex-row h-[600px]">
        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-100">
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-10"></th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Case ID</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">用例名称</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">执行时间</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    暂无测试结果
                  </td>
                </tr>
              ) : (
                filteredResults.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedResultId(row.id)}
                    className={`transition-colors cursor-pointer group ${selectedResultId === row.id ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-6 py-4">
                      <span className={`material-icons-round text-xl ${selectedResultId === row.id ? 'text-primary' : 'text-gray-300'}`}>
                        keyboard_arrow_right
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-primary font-mono text-sm">
                        <span className="material-icons-round text-base mr-1 opacity-70">folder</span>
                        {row.test_case.case_id}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">{row.test_case.title}</span>
                        <span className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
                          {row.test_case.description || '-'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex flex-col">
                        <span>{formatTime(row.start_time)}</span>
                        <span className="text-xs opacity-70">耗时 {formatDuration(row.duration)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${row.status === 'success' ? 'bg-green-100 text-green-800' :
                          row.status === 'failed' ? 'bg-red-100 text-red-800' :
                            row.status === 'running' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                        }`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${row.status === 'success' ? 'bg-green-500' :
                            row.status === 'failed' ? 'bg-red-500' :
                              row.status === 'running' ? 'bg-blue-500 animate-pulse' :
                                'bg-gray-500'
                          }`}></span>
                        {row.status === 'success' ? '通过' :
                          row.status === 'failed' ? '失败' :
                            row.status === 'running' ? '执行中' : '等待中'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Detail Pane (Right Side) */}
        {selectedResult && (
          <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-gray-100 bg-gray-50/50 flex flex-col transition-all duration-300">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
              <div>
                <h3 className="font-bold text-gray-900">执行详情</h3>
                <p className="text-xs text-gray-500">{selectedResult.test_case.case_id}</p>
              </div>
              <button onClick={() => setSelectedResultId(null)} className="text-gray-400 hover:text-gray-600">
                <span className="material-icons-round text-lg">close</span>
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* 状态信息 */}
              <div className={`rounded-md p-3 ${selectedResult.status === 'failed' ? 'bg-red-50 border border-red-100' :
                  selectedResult.status === 'success' ? 'bg-green-50 border border-green-100' :
                    'bg-gray-50 border border-gray-100'
                }`}>
                <div className="flex items-start">
                  <span className={`material-icons-round text-sm mt-0.5 mr-2 ${selectedResult.status === 'failed' ? 'text-red-500' :
                      selectedResult.status === 'success' ? 'text-green-500' :
                        'text-gray-500'
                    }`}>
                    {selectedResult.status === 'failed' ? 'error_outline' :
                      selectedResult.status === 'success' ? 'check_circle' : 'info'}
                  </span>
                  <div>
                    <h4 className={`text-xs font-bold mb-1 ${selectedResult.status === 'failed' ? 'text-red-700' :
                        selectedResult.status === 'success' ? 'text-green-700' :
                          'text-gray-700'
                      }`}>
                      {selectedResult.status === 'failed' ? '执行失败' :
                        selectedResult.status === 'success' ? '执行成功' : '等待执行'}
                    </h4>
                    {selectedResult.error_message && (
                      <p className="text-xs text-red-600 leading-relaxed">
                        {selectedResult.error_message}
                      </p>
                    )}
                    {selectedResult.status === 'success' && (
                      <p className="text-xs text-green-600">
                        用例执行通过，耗时 {formatDuration(selectedResult.duration)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* 执行日志 */}
              {selectedResult.log_content && (
                <div className="bg-[#1e1e1e] rounded-md p-3 overflow-auto max-h-48">
                  <p className="text-xs text-gray-400 mb-2">执行日志</p>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
                    {selectedResult.log_content}
                  </pre>
                </div>
              )}

              {/* Midscene 原生报告 */}
              {selectedResult.report_path && (
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 overflow-hidden">
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="material-icons-round text-indigo-500 mr-2">assessment</span>
                      <div>
                        <p className="text-sm font-medium text-indigo-800">Midscene 详细报告</p>
                        <p className="text-xs text-indigo-600">包含完整执行流程和截图</p>
                      </div>
                    </div>
                    <a
                      href={selectedResult.report_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 transition-colors"
                    >
                      <span className="material-icons-round text-sm mr-1">open_in_new</span>
                      查看报告
                    </a>
                  </div>
                </div>
              )}

              {/* 截图 */}
              {selectedResult.screenshot_path && (
                <div className="group relative bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="aspect-video w-full bg-gray-100 flex items-center justify-center relative overflow-hidden">
                    <img
                      src={selectedResult.screenshot_path}
                      alt="Screenshot"
                      className="object-cover w-full h-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect fill="%23f3f4f6" width="400" height="225"/><text fill="%239ca3af" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle">截图未找到</text></svg>';
                      }}
                    />
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium text-gray-700 truncate">执行截图</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{selectedResult.screenshot_path}</p>
                  </div>
                </div>
              )}

              {/* 时间信息 */}
              <div className="bg-white rounded-md p-3 border border-gray-100 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">开始时间</span>
                  <span className="text-gray-700">{formatTime(selectedResult.start_time)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">结束时间</span>
                  <span className="text-gray-700">{formatTime(selectedResult.end_time)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">执行耗时</span>
                  <span className="text-gray-700 font-medium">{formatDuration(selectedResult.duration)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportCenter;
