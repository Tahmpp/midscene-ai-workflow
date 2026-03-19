export enum AppState {
  UPLOAD = 'UPLOAD',
  REVIEW = 'REVIEW',
  EXECUTION = 'EXECUTION',
  REPORT = 'REPORT'
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'warning';
  yamlContent?: string;
  duration?: string;
  startTime?: string;
  endTime?: string;
  errorMessage?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'error' | 'warn';
  message: string;
  detail?: string;
}

export interface StatCardProps {
  title: string;
  value: string | number;
  icon: string;
  color: string;
  bgColor: string;
}

// 执行状态
export interface ExecutionStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  passed: number;
}

// 测试运行
export interface TestRun {
  id: number;
  status: 'pending' | 'running' | 'completed' | 'stopped' | 'failed';
  startTime: string;
  endTime?: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
}

// 测试结果
export interface TestResult {
  id: number;
  testCase: {
    caseId: string;
    title: string;
    description: string;
  };
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startTime?: string;
  endTime?: string;
  duration: number;
  errorMessage?: string;
  screenshotPath?: string;
}
