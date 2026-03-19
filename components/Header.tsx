import React from 'react';
import { AppState } from '../types';

interface HeaderProps {
  title: string;
  currentTab: AppState;
}

const Header: React.FC<HeaderProps> = ({ title, currentTab }) => {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 flex-shrink-0">
      <div className="flex items-center">
        <h2 className="text-xl font-bold text-gray-800 mr-4">{title}</h2>
        <nav className="hidden md:flex text-sm">
          <ol className="flex items-center space-x-2 text-gray-400">
            <li>自动化测试</li>
            <li>/</li>
            <li className="font-medium text-gray-600">
                {currentTab === AppState.UPLOAD || currentTab === AppState.REVIEW ? '配置向导' : 
                 currentTab === AppState.EXECUTION ? '执行监控' : '分析报告'}
            </li>
          </ol>
        </nav>
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative">
          <span className="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">search</span>
          <input 
            type="text" 
            placeholder="搜索..." 
            className="pl-10 pr-12 py-1.5 bg-gray-100 border-none rounded-md text-sm text-gray-700 focus:ring-2 focus:ring-primary w-64 placeholder-gray-400 outline-none"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-white rounded text-xs text-gray-400 border border-gray-200">⌘K</div>
        </div>

        <button className="relative p-1 text-gray-400 hover:text-gray-600">
          <span className="material-icons-round">notifications</span>
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"></span>
        </button>

        <div className="flex items-center cursor-pointer pl-2 border-l border-gray-200">
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shadow-sm">
            TS
          </div>
          <span className="ml-2 text-sm font-medium text-gray-700 hidden lg:block">测试管理员</span>
          <span className="material-icons-round text-gray-400 ml-1">expand_more</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
