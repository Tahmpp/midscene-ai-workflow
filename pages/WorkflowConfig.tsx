import React, { useState, useEffect } from 'react';
import { AppState, TestCase } from '../types';
import { MOCK_TEST_CASES } from '../constants';

interface WorkflowConfigProps {
  onStartExecution: (cases: TestCase[], deviceId?: string) => void;
}

const WorkflowConfig: React.FC<WorkflowConfigProps> = ({ onStartExecution }) => {
  const [step, setStep] = useState<'upload' | 'analyzing' | 'review'>('upload');
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null);

  // 示例文件状态
  const [exampleExcel, setExampleExcel] = useState<File | null>(null);
  const [exampleYaml, setExampleYaml] = useState<File | null>(null);
  const [showExamplePanel, setShowExamplePanel] = useState(false);

  // 设备配置状态
  const [deviceId, setDeviceId] = useState<string>('');
  const [showDevicePanel, setShowDevicePanel] = useState(true);

  // 脚本编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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

  const handleLocalScriptUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    // Directory upload attributes (non-standard but supported in Chrome/Edge/Firefox)
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.multiple = true;

    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files) as File[];
      // Filter yaml files
      const yamlFiles = files.filter(f => f.name.endsWith('.yaml') || f.name.endsWith('.yml'));

      if (yamlFiles.length === 0) {
        alert('未在文件夹中找到 YAML 文件');
        return;
      }

      setStep('analyzing');

      try {
        const scripts = await Promise.all(yamlFiles.map(async (file) => {
          const text = await file.text();
          return {
            file_name: file.name,
            content: text
          };
        }));

        const res = await fetch('/api/execution/import/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scripts })
        });

        if (!res.ok) throw new Error('Import failed');
        const cases = await res.json();

        const reportCases: TestCase[] = cases.map((c: any) => ({
          id: c.case_id,
          name: c.title,
          description: c.description || '',
          status: 'success',
          yamlContent: scripts.find((s: any) => s.file_name === c.title)?.content || '',
          duration: '0'
        }));

        setUploadedCases(reportCases);
        setSelectedCase(reportCases[0]);
        setStep('review');

      } catch (err) {
        console.error(err);
        alert('Local import failed: ' + err);
        setStep('upload');
      }
    };

    input.click();
  };

  const [uploadedCases, setUploadedCases] = useState<TestCase[]>([]);

  // 复制脚本到剪贴板
  const handleCopyScript = async () => {
    if (!selectedCase?.yamlContent) return;
    try {
      await navigator.clipboard.writeText(selectedCase.yamlContent);
      alert('脚本已复制到剪贴板');
    } catch (err) {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制');
    }
  };

  // 下载脚本文件
  const handleDownloadScript = () => {
    if (!selectedCase?.yamlContent) return;
    const blob = new Blob([selectedCase.yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedCase.id || 'script'}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 开始编辑
  const handleStartEdit = () => {
    if (!selectedCase) return;
    setEditedContent(selectedCase.yamlContent || '');
    setIsEditing(true);
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedContent('');
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!selectedCase || !editedContent) return;

    setIsSaving(true);
    try {
      // 调用 API 保存到后端
      const response = await fetch(`/api/scripts/${selectedCase.id}/update/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml_content: editedContent })
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }

      // 更新本地状态
      const updatedCase = { ...selectedCase, yamlContent: editedContent };
      setSelectedCase(updatedCase);
      setUploadedCases(prev =>
        prev.map(c => c.id === selectedCase.id ? updatedCase : c)
      );

      setIsEditing(false);
      setEditedContent('');
      alert('脚本已保存');
    } catch (err) {
      console.error('保存失败:', err);
      alert('保存失败: ' + err);
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="text-sm text-gray-500 mb-2">
        通过上传测试用例 Excel，DeepSeek AI 将自动生成 Midscene 可执行的 YAML 文件。
      </div>

      {step === 'upload' && (
        <div className="space-y-4">

          {/* 1. AI Learning Example (Optional, Moved to Top) */}
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
                  <h4 className="text-sm font-semibold text-gray-800">1. AI 学习示例（可选）</h4>
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
                    className={`flex items-center p-4 rounded-lg border-2 border-dashed cursor-pointer transition-all ${exampleExcel
                      ? 'border-green-300 bg-green-50'
                      : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                      }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${exampleExcel ? 'bg-green-100' : 'bg-gray-100'
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
                    className={`flex items-center p-4 rounded-lg border-2 border-dashed cursor-pointer transition-all ${exampleYaml
                      ? 'border-green-300 bg-green-50'
                      : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                      }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${exampleYaml ? 'bg-green-100' : 'bg-gray-100'
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

          {/* 2. Device Configuration Panel (Required, Moved to Middle) */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowDevicePanel(!showDevicePanel)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <span className="material-icons-round text-green-600 text-lg">tv</span>
                </div>
                <div className="text-left">
                  <h4 className="text-sm font-semibold text-gray-800">2. Android TV 设备配置 <span className="text-red-500">*</span></h4>
                  <p className="text-xs text-gray-500">配置要连接的 Android TV 设备地址</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {deviceId && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 font-medium">
                    已配置
                  </span>
                )}
                {!deviceId && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600 font-medium">
                    必填
                  </span>
                )}
                <span className={`material-icons-round text-gray-400 transition-transform ${showDevicePanel ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </div>
            </button>

            {showDevicePanel && (
              <div className="px-6 pb-6 border-t border-gray-100">
                <div className="mt-4 space-y-4">
                  {/* Device IP Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      设备地址
                    </label>
                    <div className="flex items-center space-x-3">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 material-icons-round text-gray-400 text-lg">
                          router
                        </span>
                        <input
                          type="text"
                          value={deviceId}
                          onChange={(e) => setDeviceId(e.target.value)}
                          placeholder="例如 192.168.1.102 (可省略端口)"
                          className={`w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm transition-all focus:ring-2 ${!deviceId ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-gray-300 focus:border-green-500 focus:ring-green-500'}`}
                        />
                      </div>
                      {deviceId && (
                        <button
                          onClick={() => setDeviceId('')}
                          className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="清除"
                        >
                          <span className="material-icons-round text-lg">close</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quick Connect Tips */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="text-xs font-semibold text-gray-700 mb-2 flex items-center">
                      <span className="material-icons-round text-xs mr-1">help_outline</span>
                      连接说明
                    </h5>
                    <ul className="text-xs text-gray-500 space-y-1.5">
                      <li className="flex items-start">
                        <span className="text-green-500 mr-2">1.</span>
                        确保电脑和 Android TV 在同一局域网内
                      </li>
                      <li className="flex items-start">
                        <span className="text-green-500 mr-2">2.</span>
                        在电视上开启「开发者选项」→「网络调试」
                      </li>
                      <li className="flex items-start">
                        <span className="text-green-500 mr-2">3.</span>
                        输入 IP 地址即可，系统会自动尝试连接
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Upload Excel Area (Moved to Bottom) */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 relative">
            <div className="absolute top-4 left-4 flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <span className="material-icons-round text-blue-600 text-lg">upload_file</span>
              </div>
              <h4 className="text-sm font-semibold text-gray-800">3. 上传测试用例</h4>
            </div>

            <div
              onClick={() => {
                if (!deviceId) {
                  alert('请先填写设备地址！');
                  return;
                }
                handleFileUpload();
              }}
              className={`mt-8 flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-16 transition-all cursor-pointer group ${!deviceId ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' : 'border-blue-200 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-400'}`}
            >
              <div className="flex items-center justify-center h-20 w-20 rounded-full bg-blue-100 text-primary mb-6 group-hover:scale-110 transition-transform">
                <span className="material-icons-round text-4xl">cloud_upload</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">点击或拖拽上传测试用例 Excel</h3>
              <p className="text-gray-500 mb-6">支持 .xlsx, .xls 格式</p>

              {!deviceId && (
                <p className="text-red-500 font-medium text-sm">请先在上方填写设备地址</p>
              )}

              <div className="flex items-center space-x-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-4 py-1.5 rounded-full text-sm font-semibold shadow-md">
                <span className="material-icons-round text-sm">auto_awesome</span>
                <span>Powered by DeepSeek AI</span>
              </div>
            </div>

            {/* Direct Execute Logic Button */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  if (!deviceId) {
                    alert('请先填写设备地址！');
                    return;
                  }
                  // Skip Excel, go to review directly via folder upload? 
                  // Wait, user said "buttons... in config page bottom right... after press jump to ready to execute stage... then upload local script"
                  // I will simulate this by immediately going to 'review' with empty list, or a special empty state.
                  // Actually, reusing the 'review' steps but with an empty list is fine, if I add the upload button there.
                  setUploadedCases([]);
                  setStep('review');
                }}
                className="flex items-center text-sm text-gray-600 hover:text-primary transition-colors"
              >
                <span className="material-icons-round text-lg mr-1">folder_open</span>
                直接执行本地脚本
              </button>
            </div>
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
            <h4 className={`mt-3 text-sm font-bold ${step === 'analyzing' || step === 'review' ? 'text-gray-900' : 'text-gray-400'}`}>Excel 解析 / 脚本导入</h4>
            {step === 'review' && <p className="text-xs text-gray-500 mt-1">已就绪 {uploadedCases.length} 个用例</p>}
          </div>

          <div className={`flex-1 h-0.5 absolute left-0 right-0 top-5 transition-colors duration-700 delay-100`} style={{ left: '10%', right: '50%', background: step === 'analyzing' || step === 'review' ? '#10B981' : '#E5E7EB' }}></div>

          {/* Step 2 */}
          <div className="flex flex-col items-center relative z-10 w-40">
            {/* If importing local, we skip AI, so maybe this step should be "Script Ready" */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md ring-4 ring-white transition-all duration-500 ${step === 'analyzing' ? 'bg-primary text-white animate-pulse' : step === 'review' ? 'bg-success text-white' : 'bg-gray-200 text-gray-400'}`}>
              <span className="material-icons-round">{step === 'review' ? 'check' : 'psychology'}</span>
            </div>
            <h4 className={`mt-3 text-sm font-bold ${step === 'analyzing' ? 'text-primary' : step === 'review' ? 'text-gray-900' : 'text-gray-400'}`}>AI 生成 / 本地加载</h4>
            {step === 'analyzing' && <p className="text-xs text-primary mt-1">处理中...</p>}
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
                <h3 className="font-semibold text-gray-800 text-sm">生成的脚本列表</h3>
                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full text-gray-600">{uploadedCases.length}</span>
              </div>

              {/* Add "Upload Local Script folder" button here if list is empty or always? 
                  User said: "Upload local script button" ... "read all yaml files... loaded in interface"
               */}
              <div className="p-2 border-b border-gray-100">
                <button
                  onClick={handleLocalScriptUpload}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  <span className="material-icons-round text-sm mr-2">create_new_folder</span>
                  导入本地脚本文件夹
                </button>
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
                {uploadedCases.length === 0 && (
                  <div className="text-center py-10 text-gray-400 text-sm">
                    <p>暂无脚本</p>
                    <p className="text-xs mt-1">请上传 Excel 生成或导入本地脚本</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Editor */}
            <div className="col-span-12 lg:col-span-9 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-mono text-gray-600">{selectedCase?.name || '未选择'}</span>
                  {selectedCase && !isEditing && (
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">Script Ready</span>
                  )}
                  {isEditing && (
                    <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 font-medium flex items-center">
                      <span className="material-icons-round text-xs mr-1">edit</span>
                      编辑中
                    </span>
                  )}
                </div>
                <div className="flex space-x-1">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={handleCopyScript}
                        disabled={!selectedCase}
                        className="text-gray-400 hover:text-blue-600 hover:bg-blue-50 p-1.5 rounded transition-colors disabled:opacity-50"
                        title="复制脚本"
                      >
                        <span className="material-icons-round text-sm">content_copy</span>
                      </button>
                      <button
                        onClick={handleStartEdit}
                        disabled={!selectedCase}
                        className="text-gray-400 hover:text-green-600 hover:bg-green-50 p-1.5 rounded transition-colors disabled:opacity-50"
                        title="编辑脚本"
                      >
                        <span className="material-icons-round text-sm">edit</span>
                      </button>
                      <button
                        onClick={handleDownloadScript}
                        disabled={!selectedCase}
                        className="text-gray-400 hover:text-purple-600 hover:bg-purple-50 p-1.5 rounded transition-colors disabled:opacity-50"
                        title="下载脚本"
                      >
                        <span className="material-icons-round text-sm">download</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleCancelEdit}
                        className="text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-1 rounded text-sm font-medium transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={isSaving}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm font-medium transition-colors flex items-center disabled:opacity-50"
                      >
                        {isSaving ? (
                          <>
                            <span className="material-icons-round text-sm mr-1 animate-spin">sync</span>
                            保存中...
                          </>
                        ) : (
                          <>
                            <span className="material-icons-round text-sm mr-1">save</span>
                            保存
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex-1 bg-[#1e1e1e] text-gray-300 overflow-auto font-mono text-sm leading-relaxed">
                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full h-full bg-transparent text-gray-300 p-4 resize-none focus:outline-none font-mono text-sm leading-relaxed"
                    placeholder="在此编辑 YAML 脚本..."
                    spellCheck={false}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap p-4">
                    <code>
                      {selectedCase?.yamlContent || 'Please select a test case to view script'}
                    </code>
                  </pre>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center bg-white rounded-xl shadow-lg border border-gray-200 p-4 sticky bottom-6 z-20">
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <span className="material-icons-round text-primary">info</span>
              <span>共加载 {uploadedCases.length} 个文件</span>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setStep('upload')}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                返回配置
              </button>
              <button
                disabled={uploadedCases.length === 0}
                onClick={() => onStartExecution(uploadedCases, deviceId || undefined)}
                className={`px-6 py-2 rounded-lg text-sm font-medium shadow-md flex items-center transition-all transform ${uploadedCases.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-primary hover:bg-blue-600 text-white shadow-blue-500/30 hover:scale-105'}`}
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
