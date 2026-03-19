import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import WorkflowConfig from './pages/WorkflowConfig';
import ExecutionMonitor from './pages/ExecutionMonitor';
import ReportCenter from './pages/ReportCenter';
import { AppState, TestCase } from './types';

const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<AppState>(AppState.UPLOAD);
  
  // 全局状态：测试用例列表和当前运行 ID
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);

  const getTitle = () => {
    switch(currentTab) {
      case AppState.UPLOAD:
      case AppState.REVIEW:
        return '测试工作流配置';
      case AppState.EXECUTION:
        return '执行监控中心';
      case AppState.REPORT:
        return '测试报告中心';
      default:
        return 'Dashboard';
    }
  };

  // 从 WorkflowConfig 接收用例数据，启动执行
  const handleStartExecution = (cases: TestCase[]) => {
    setTestCases(cases);
    setCurrentTab(AppState.EXECUTION);
  };

  // 执行完成，记录运行 ID
  const handleExecutionComplete = (runId: number) => {
    setCurrentRunId(runId);
    setCurrentTab(AppState.REPORT);
  };

  // 重新开始
  const handleRestart = () => {
    setTestCases([]);
    setCurrentRunId(null);
    setCurrentTab(AppState.UPLOAD);
  };

  const renderContent = () => {
    switch (currentTab) {
      case AppState.UPLOAD:
      case AppState.REVIEW:
        return <WorkflowConfig onStartExecution={handleStartExecution} />;
      case AppState.EXECUTION:
        return (
          <ExecutionMonitor 
            testCases={testCases} 
            onComplete={handleExecutionComplete} 
          />
        );
      case AppState.REPORT:
        return (
          <ReportCenter 
            runId={currentRunId} 
            onRestart={handleRestart} 
          />
        );
      default:
        return <WorkflowConfig onStartExecution={handleStartExecution} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar 
        currentTab={currentTab} 
        onNavigate={(tab) => setCurrentTab(tab)} 
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={getTitle()} currentTab={currentTab} />
        <main className="flex-1 overflow-y-auto p-8">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default App;
