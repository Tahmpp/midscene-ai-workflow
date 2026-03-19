import React, { useState } from 'react';
import { MOCK_TEST_CASES } from '../constants';
import { TestCase } from '../types';

interface ReportCenterProps {
    onRestart: () => void;
}

const ReportCenter: React.FC<ReportCenterProps> = ({ onRestart }) => {
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>('TC-2024-1024');

  // Augment mock data with final statuses for the report view
  const reportData: TestCase[] = MOCK_TEST_CASES.map((tc, idx) => ({
    ...tc,
    status: idx === 0 ? 'failed' : idx === 2 ? 'running' : 'success'
  }));

  const activeCase = reportData.find(c => c.id === selectedCaseId);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">测试报告中心</h1>
          <p className="text-sm text-gray-500 mt-1">Midscene AI 驱动的自动化测试结果与回放</p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition-all shadow-sm flex items-center">
            <span className="material-icons-round text-base mr-2">folder_open</span>
            本地报告
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
          { label: '今日执行', val: '124', icon: 'analytics', color: 'text-primary', bg: 'bg-blue-50' },
          { label: '通过率', val: '94.2%', icon: 'check_circle', color: 'text-green-600', bg: 'bg-green-50' },
          { label: '发现缺陷', val: '7', icon: 'bug_report', color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'AI 分析耗时', val: '12m', icon: 'auto_awesome', color: 'text-purple-600', bg: 'bg-purple-50' },
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
          <span className="material-icons-round absolute left-3 top-2.5 text-gray-400 text-lg">filter_alt</span>
          <input className="pl-10 pr-4 py-2 text-sm w-full bg-white border border-gray-300 rounded-md focus:ring-1 focus:ring-primary outline-none" placeholder="按测试用例 ID 或名称筛选..." type="text"/>
        </div>
        <div className="flex items-center space-x-2">
            <select className="pl-3 pr-8 py-2 text-sm bg-white border border-gray-300 rounded-md text-gray-700 outline-none">
                <option>所有状态</option>
                <option>通过</option>
                <option>失败</option>
            </select>
            <button className="p-2 text-gray-500 hover:text-primary bg-gray-50 rounded-md border border-transparent hover:border-gray-200 transition-all">
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
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reportData.map((row) => (
                <tr 
                    key={row.id} 
                    onClick={() => setSelectedCaseId(row.id)}
                    className={`transition-colors cursor-pointer group ${selectedCaseId === row.id ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-6 py-4">
                    <span className={`material-icons-round text-xl ${selectedCaseId === row.id ? 'text-primary' : 'text-gray-300'}`}>
                        {selectedCaseId === row.id ? 'keyboard_arrow_right' : 'keyboard_arrow_right'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-primary font-mono text-sm">
                      <span className="material-icons-round text-base mr-1 opacity-70">folder</span>
                      {row.id}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900">{row.description}</span>
                      <span className="text-xs text-gray-500 mt-0.5 flex items-center">
                        <span className="material-icons-round text-[10px] mr-1 text-purple-500">auto_awesome</span> 
                        Midscene AI 生成
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex flex-col">
                      <span>今天 10:42:31</span>
                      <span className="text-xs opacity-70">耗时 {row.duration}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        row.status === 'success' ? 'bg-green-100 text-green-800' :
                        row.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                          row.status === 'success' ? 'bg-green-500' :
                          row.status === 'failed' ? 'bg-red-500' :
                          'bg-blue-500 animate-pulse'
                      }`}></span>
                      {row.status === 'success' ? '通过' : row.status === 'failed' ? '失败' : '执行中'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                    <button className="text-gray-400 hover:text-primary transition-colors"><span className="material-icons-round text-xl">description</span></button>
                    <button className="text-gray-400 hover:text-primary transition-colors"><span className="material-icons-round text-xl">image</span></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail Pane (Right Side) */}
        {activeCase && (
          <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-gray-100 bg-gray-50/50 flex flex-col transition-all duration-300">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
              <div>
                <h3 className="font-bold text-gray-900">执行快照</h3>
                <p className="text-xs text-gray-500">{activeCase.id}</p>
              </div>
              <button onClick={() => setSelectedCaseId(null)} className="text-gray-400 hover:text-gray-600">
                <span className="material-icons-round text-lg">close</span>
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
                {activeCase.status === 'failed' && (
                    <div className="bg-red-50 border border-red-100 rounded-md p-3">
                        <div className="flex items-start">
                        <span className="material-icons-round text-red-500 text-sm mt-0.5 mr-2">error_outline</span>
                        <div>
                            <h4 className="text-xs font-bold text-red-700 mb-1">AssertionError: Payment Timeout</h4>
                            <p className="text-xs text-red-600 leading-relaxed">Expected element '#success-modal' not found after 30s. Midscene AI detected a potential backend latency issue.</p>
                        </div>
                        </div>
                    </div>
                )}

                {/* Screenshots Gallery */}
                {[1, 2, 3].map((num) => (
                    <div key={num} className="group relative bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                        <div className="aspect-video w-full bg-gray-100 flex items-center justify-center relative overflow-hidden">
                            <img 
                                src={`https://picsum.photos/400/225?random=${num + parseInt(activeCase.id.slice(-2))}`} 
                                alt="Screenshot" 
                                className="object-cover w-full h-full opacity-90 group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                <button className="bg-white/20 hover:bg-white/40 backdrop-blur-sm p-2 rounded-full text-white transition-colors">
                                <span className="material-icons-round">zoom_in</span>
                                </button>
                            </div>
                        </div>
                        <div className="p-2">
                            <p className="text-xs font-medium text-gray-700 truncate">screenshot_step_{num}.png</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">midscene_run/report/assets</p>
                        </div>
                    </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportCenter;
