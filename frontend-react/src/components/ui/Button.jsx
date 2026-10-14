import React from 'react';

const sizeClasses = {
  sm: 'px-3.5 py-2 text-xs',
  md: 'px-6 py-3.5 text-sm',
  lg: 'px-8 py-4.5 text-base',
};

const variantClasses = {
  primary: 'bg-[#C9FF68] hover:bg-[#d8ff85] text-[#090D0E] font-bold shadow-sm active:bg-[#b8f055]',
  secondary: 'bg-[#151D20] hover:bg-[#1C262A] text-[#F4F6F2] border border-white/10 shadow-sm',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm active:bg-red-800',
  ghost: 'bg-transparent hover:bg-white/5 text-[#9BA9A5] hover:text-[#F4F6F2]',
  outline: 'bg-transparent border border-white/15 hover:bg-white/5 text-[#F4F6F2] hover:border-white/30',
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
