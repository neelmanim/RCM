import React from 'react';
import { SearchInput } from '../../components/ui/SearchInput';

export const SearchBar = ({ value, onChange }) => (
  <SearchInput
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder="Search the guide..."
    className="mb-5"
  />
);
