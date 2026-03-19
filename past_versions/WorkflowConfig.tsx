import React, { useState, useEffect } from 'react';
import { AppState, TestCase } from '../types';
import { MOCK_TEST_CASES } from '../constants';

interface WorkflowConfigProps {
  onNext: () => void;
}

const WorkflowConfig: React.FC<WorkflowConfigProps> = ({ onNext }) => {
  const [step, setStep] = useState<'upload' | 'analyzing' | 'review'>('upload');
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null);
  
  // 示例文件状态
  const [exampleExcel, setExampleExcel] = useState<File | null>(null);
  const [exampleYaml, setExampleYaml] = useState<File | null>(null);
  const [showExamplePanel, setShowExamplePanel] = useState(false);

  // 上传示例 Excel
  const handleExampleExcelUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx, .xls';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) setExampleExcel(file);
    };
    input.click();
  };

  // 上传示例 YAML
  const handleExampleYamlUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml, .yml';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) setExampleYaml(file);
    };
    input.click();
  };

  // 清除示例文件
  const clearExampleFiles = () => {
    setExampleExcel(null);
    setExampleYaml(null);
  };

  // API Integration
  const handleFileUpload = async () => {
    // Hidden file input trigger
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx, .xls';

    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      setStep('analyzing');

      const formData = new FormData();
      formData.append('file', file);

      try {
        // 1. Upload
        const uploadRes = await fetch('/api/upload/', {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) throw new Error('Upload failed');
        const cases = await uploadRes.json();
        const caseIds = cases.map((c: any) => c.case_id);

        // 2. Generate (with optional example files for few-shot learning)
        const genFormData = new FormData();
        genFormData.append('case_ids', JSON.stringify(caseIds));
        if (exampleExcel) {
          genFormData.append('example_excel', exampleExcel);
        }
        if (exampleYaml) {
          genFormData.append('example_yaml', exampleYaml);
        }
        
        const genRes = await fetch('/api/generate/', {
          method: 'POST',
          body: genFormData,
        });
        if (!genRes.ok) throw new Error('Generation failed');
        const scripts = await genRes.json();

        // 3. Map to UI
        const reportCases: TestCase[] = cases.map((c: any) => {
          const script = scripts.find((s: any) => s.test_case === c.id); // Note: verify ID matching
          // Wait, backend 'generate_script' returns GeneratedScript objects
          // GeneratedScript.test_case is the FK ID (int), c.id is int ID. 
          // c.case_id is string "TC-001"

          return {
            id: c.case_id, // Map case_id to UI id
            name: c.title,
            description: c.description || '',
            status: 'success',
            yamlContent: script ? script.yaml_content : '# No script generated',
            duration: '0'
          };
        });

        setSelectedCase(reportCases[0]);
        // Update mock for now or pass prop? 
        // For this demo, we just verify flow. 
        // ideally we lift state up or use a context.
        // I will force update the view by storing in local state "uploadedCases"
        // But the current UI uses MOCK_TEST_CASES. I need to Replace MOCK_TEST_CASES usage.
        setUploadedCases(reportCases);
        setStep('review');

      } catch (err) {
        console.error(err);
        alert('Process failed: ' + err);
        setStep('upload');
      }
    };

    input.click();
  };

  const [uploadedCases, setUploadedCases] = useState<TestCase[]>([]);

  // Replace MOCK_TEST_CASES with uploadedCases in render

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="text-sm text-gray-500 mb-2">
        通过上传测试用例 Excel，DeepSeek AI 将自动生成 Midscene 可执行的 YAML 文件。
      </div>

      {/* Upload Zone */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Main Upload Area */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div
              onClick={handleFileUpload}
              className="flex flex-col items-center justify-center border-2 border-dashed border-blue-200 rounded-lg p-16 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-center h-20 w-20 rounded-full bg-blue-100 text-primary mb-6 group-hover:scale-110 transition-transform">
                <span className="material-icons-round text-4xl">cloud_upload</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">点击或拖拽上传测试用例 Excel</h3>
              <p className="text-gray-500 mb-6">支持 .xlsx, .xls 格式</p>
              <div className="flex items-center space-x-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-4 py-1.5 rounded-full text-sm font-semibold shadow-md">
                <span className="material-icons-round text-sm">auto_awesome</span>
                <span>Powered by DeepSeek AI</span>
              </div>
            </div>
          </div>

          {/* Example Files Panel */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowExamplePanel(!showExamplePanel)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <span className="material-icons-round text-purple-600 text-lg">school</span>
                </div>
                <div className="text-left">
                  <h4 className="text-sm font-semibold text-gray-800">AI 学习示例（可选）</h4>
                  <p className="text-xs text-gray-500">上传示例文件，让 AI 生成更符合预期的脚本</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {(exampleExcel || exampleYaml) && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 font-medium">
                    已配置
                  </span>
                )}
                <span className={`material-icons-round text-gray-400 transition-transform ${showExamplePanel ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </div>
            </button>

            {showExamplePanel && (
              <div className="px-6 pb-6 border-t border-gray-100">
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Example Excel */}
                  <div
                    onClick={handleExampleExcelUpload}
                    className={`flex items-center p-4 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
                      exampleExcel 
                        ? 'border-green-300 bg-green-50' 
                        : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${
                      exampleExcel ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <span className={`material-icons-round ${exampleExcel ? 'text-green-600' : 'text-gray-400'}`}>
                        {exampleExcel ? 'check_circle' : 'table_chart'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {exampleExcel ? exampleExcel.name : '示例 Excel 文件'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {exampleExcel ? '点击更换' : '上传一个示例测试用例文件'}
                      </p>
                    </div>
                  </div>

                  {/* Example YAML */}
                  <div
                    onClick={handleExampleYamlUpload}
                    className={`flex items-center p-4 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
                      exampleYaml 
                        ? 'border-green-300 bg-green-50' 
                        : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${
                      exampleYaml ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <span className={`material-icons-round ${exampleYaml ? 'text-green-600' : 'text-gray-400'}`}>
                        {exampleYaml ? 'check_circle' : 'code'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {exampleYaml ? exampleYaml.name : '示例 YAML 脚本'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {exampleYaml ? '点击更换' : '上传对应的期望输出脚本'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tips & Clear Button */}
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-gray-500 flex items-center">
                    <span className="material-icons-round text-xs mr-1">info</span>
                    未上传时将使用系统默认示例
                  </p>
                  {(exampleExcel || exampleYaml) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); clearExampleFiles(); }}
                      className="text-xs text-red-500 hover:text-red-600 flex items-center"
                    >
                      <span className="material-icons-round text-xs mr-1">delete</span>
                      清除示例
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress Stepper */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between max-w-4xl mx-auto relative">
          {/* Step 1 */}
          <div className="flex flex-col items-center relative z-10 w-40">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md ring-4 ring-white transition-colors duration-500 ${step === 'analyzing' || step === 'review' ? 'bg-success' : 'bg-gray-200 text-gray-400'}`}>
              <span className="material-icons-round">check</span>
            </div>
            <h4 className={`mt-3 text-sm font-bold ${step === 'analyzing' || step === 'review' ? 'text-gray-900' : 'text-gray-400'}`}>Excel 解析</h4>
            {step === 'review' && <p className="text-xs text-gray-500 mt-1">已识别 {uploadedCases.length} 个用例</p>}
          </div>

          <div className={`flex-1 h-0.5 absolute left-0 right-0 top-5 transition-colors duration-700 delay-100`} style={{ left: '10%', right: '50%', background: step === 'analyzing' || step === 'review' ? '#10B981' : '#E5E7EB' }}></div>

          {/* Step 2 */}
          <div className="flex flex-col items-center relative z-10 w-40">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md ring-4 ring-white transition-all duration-500 ${step === 'analyzing' ? 'bg-primary text-white animate-pulse' : step === 'review' ? 'bg-success text-white' : 'bg-gray-200 text-gray-400'}`}>
              <span className="material-icons-round">{step === 'review' ? 'check' : 'psychology'}</span>
            </div>
            <h4 className={`mt-3 text-sm font-bold ${step === 'analyzing' ? 'text-primary' : step === 'review' ? 'text-gray-900' : 'text-gray-400'}`}>AI 生成 YAML</h4>
            {step === 'analyzing' && <p className="text-xs text-primary mt-1">生成中...</p>}
          </div>

          <div className={`flex-1 h-0.5 absolute left-0 right-0 top-5 transition-colors duration-700 delay-200`} style={{ left: '50%', right: '10%', background: step === 'review' ? '#10B981' : '#E5E7EB' }}></div>

          {/* Step 3 */}
          <div className="flex flex-col items-center relative z-10 w-40">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md ring-4 ring-white transition-colors duration-500 ${step === 'review' ? 'bg-primary text-white' : 'bg-gray-200 text-gray-400'}`}>
              <span className="material-icons-round">play_arrow</span>
            </div>
            <h4 className={`mt-3 text-sm font-medium ${step === 'review' ? 'text-primary' : 'text-gray-400'}`}>准备执行</h4>
            {step === 'review' && <p className="text-xs text-gray-500 mt-1">等待确认</p>}
          </div>
        </div>
      </div>

      {/* Review View */}
      {step === 'review' && (
        <>
          <div className="grid grid-cols-12 gap-6 h-[600px]">
            {/* Left: List */}
            <div className="col-span-12 lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <h3 className="font-semibold text-gray-800 text-sm">生成的 YAML 文件</h3>
                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full text-gray-600">{uploadedCases.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {uploadedCases.map((tc) => (
                  <div
                    key={tc.id}
                    onClick={() => setSelectedCase(tc)}
                    className={`flex items-center p-3 rounded-md cursor-pointer border-l-4 transition-colors ${selectedCase?.id === tc.id ? 'bg-blue-50 border-primary' : 'hover:bg-gray-50 border-transparent'}`}
                  >
                    <span className={`material-icons-round text-sm mr-3 ${selectedCase?.id === tc.id ? 'text-primary' : 'text-gray-400'}`}>description</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selectedCase?.id === tc.id ? 'text-primary' : 'text-gray-700'}`}>{tc.name}</p>
                      <p className="text-xs text-gray-500">{tc.description}</p>
                    </div>
                    <span className="material-icons-round text-success text-xs">check_circle</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Editor */}
            <div className="col-span-12 lg:col-span-9 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-mono text-gray-600">{selectedCase?.name}</span>
                  <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">Generated by DeepSeek</span>
                </div>
                <div className="flex space-x-2">
                  <button className="text-gray-400 hover:text-gray-600 p-1"><span className="material-icons-round text-sm">content_copy</span></button>
                  <button className="text-gray-400 hover:text-gray-600 p-1"><span className="material-icons-round text-sm">edit</span></button>
                  <button className="text-gray-400 hover:text-gray-600 p-1"><span className="material-icons-round text-sm">download</span></button>
                </div>
              </div>
              <div className="flex-1 bg-[#1e1e1e] text-gray-300 p-4 overflow-auto font-mono text-sm leading-relaxed">
                <pre className="whitespace-pre-wrap">
                  <code>
                    {selectedCase?.yamlContent || 'No content selected'}
                  </code>
                </pre>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center bg-white rounded-xl shadow-lg border border-gray-200 p-4 sticky bottom-6 z-20">
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <span className="material-icons-round text-primary">info</span>
              <span>共生成 {uploadedCases.length} 个文件，预计执行耗时 3m 45s</span>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setStep('upload')}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                重新生成
              </button>
              <button
                onClick={onNext}
                className="px-6 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm font-medium shadow-md shadow-blue-500/30 flex items-center transition-all transform hover:scale-105"
              >
                <span className="material-icons-round mr-2 text-sm">play_circle_filled</span>
                开始批量执行
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WorkflowConfig;
