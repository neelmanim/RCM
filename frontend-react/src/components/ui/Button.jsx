import React from 'react';

const sizeClasses = {
  sm: 'px-3.5 py-2 text-xs',
  md: 'px-6 py-3.5 text-sm',
  lg: 'px-8 py-4.5 text-base',
};

const variantClasses = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:bg-blue-800',
  secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm active:bg-red-800',
  ghost: 'bg-transparent hover:bg-slate-100 text-slate-600',
  outline: 'bg-transparent border border-slate-200 hover:bg-slate-50 text-slate-700',
};

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  ...props
}) => {
  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2 rounded-xl font-bold
        transition-all duration-150 cursor-pointer border-none outline-none
        disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
        ${sizeClasses[size] || sizeClasses.md}
        ${variantClasses[variant] || variantClasses.primary}
        ${className}
      `}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
