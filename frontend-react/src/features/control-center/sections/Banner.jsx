import React from 'react';

// Inline error / success / test-result line shared by the integration cards.
export const Banner = ({ text, tone }) => (!text ? null : (
  <p role="alert" className={`text-xs rounded-lg p-2 ${tone === 'ok' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>{text}</p>
));
