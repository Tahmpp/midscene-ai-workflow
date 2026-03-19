import React from 'react';
import { AppState } from '../types';

interface SidebarProps {
  currentTab: AppState;
  onNavigate: (tab: AppState) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentTab, onNavigate }) => {
  const menuItems = [
    { section: '自动化测试', items: [
      { icon: 'playlist_add_check', label: '工作流配置', id: AppState.UPLOAD, activeIds: [AppState.UPLOAD, AppState.REVIEW] },
      { icon: 'play_circle', label: '执行监控', id: AppState.EXECUTION, activeIds: [AppState.EXECUTION] },
      { icon: 'assessment', label: '报表中心', id: AppState.REPORT, activeIds: [AppState.REPORT] },
    ]},
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-20">
      <div className="h-16 flex items-center px-6 border-b border-gray-100">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white mr-3 shadow-sm">
          <span className="material-icons-round text-xl">bolt</span>
        </div>
        <h1 className="text-lg font-bold tracking-tight text-gray-800">研发效能</h1>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {menuItems.map((section, idx) => (
          <div key={idx}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2 mt-4 first:mt-2">
              {section.section}
            </div>
            {section.items.map((item) => {
              const isActive = item.activeIds 
                ? item.activeIds.includes(currentTab) 
                : false;
              
              return (
                <button
                  key={item.label}
                  onClick={() => {
                     // Only allow navigation if it's one of our implemented pages, otherwise do nothing
                     if(Object.values(AppState).includes(item.id as AppState)) {
                        onNavigate(item.id as AppState);
                     }
                  }}
                  className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive 
                      ? 'bg-blue-50 text-primary' 
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className={`material-icons-round mr-3 ${isActive ? 'text-primary' : 'text-gray-400'}`}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <button className="flex items-center px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 w-full">
          <span className="material-icons-round mr-3 text-gray-400">settings</span>
          系统设置
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
