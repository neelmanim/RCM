import React from 'react';
import { Search } from 'lucide-react';

export const SearchBar = ({ value, onChange }) => (
  <div className="relative mb-5">
    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Search the guide..."
      className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm border border-slate-200 bg-white
        placeholder:text-slate-400 outline-none transition-all
        focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
    />
  </div>
);
